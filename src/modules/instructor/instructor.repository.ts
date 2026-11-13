import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type {
  InstructorStatus,
  KycStatus,
  OnboardingStage,
} from '../../generated/prisma/enums';

/**
 * Prisma queries for instructor profiles and their documents. No rules here.
 *
 * Documents are polymorphic by `(ownerType, ownerId)`, so **every** document
 * query in this file pins `ownerType: 'INSTRUCTOR'` and an `ownerId`. Dropping
 * either would let one teacher read another's PAN, or a customer's — the
 * ownership check is at the query, never in the controller.
 */
@Injectable()
export class InstructorRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------------------------------------------- profile

  findProfileByUserId(userId: string) {
    return this.prisma.instructorProfile.findFirst({
      where: { userId, deletedAt: null },
    });
  }

  findProfileById(id: string) {
    return this.prisma.instructorProfile.findFirst({
      where: { id, deletedAt: null },
      include: {
        user: {
          select: { id: true, mobile: true, email: true, status: true },
        },
        branch: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Creates the application and grants the INSTRUCTOR role in one transaction.
   * A profile without the role would be invisible to `RolesGuard`, and the role
   * without a profile would 404 on every instructor route — the pair must land
   * together or not at all.
   */
  createApplication(
    userId: string,
    data: Omit<Prisma.InstructorProfileUncheckedCreateInput, 'userId'>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { roles: true },
      });

      if (!user.roles.includes('INSTRUCTOR')) {
        await tx.user.update({
          where: { id: userId },
          data: { roles: { set: [...user.roles, 'INSTRUCTOR'] } },
        });
      }

      return tx.instructorProfile.create({ data: { ...data, userId } });
    });
  }

  updateProfile(id: string, data: Prisma.InstructorProfileUpdateInput) {
    return this.prisma.instructorProfile.update({ where: { id }, data });
  }

  /** Page of the applicant pipeline, newest application first. */
  async listProfiles(filter: {
    stage?: OnboardingStage;
    kycStatus?: KycStatus;
    status?: InstructorStatus;
    branchId?: string;
    q?: string;
    skip: number;
    take: number;
  }) {
    const where: Prisma.InstructorProfileWhereInput = {
      deletedAt: null,
      ...(filter.stage && { onboardingStage: filter.stage }),
      ...(filter.kycStatus && { kycStatus: filter.kycStatus }),
      ...(filter.status && { status: filter.status }),
      ...(filter.branchId && { branchId: filter.branchId }),
      ...(filter.q && {
        OR: [
          { name: { contains: filter.q, mode: 'insensitive' } },
          { user: { mobile: { contains: filter.q } } },
        ],
      }),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.instructorProfile.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
        include: {
          user: { select: { id: true, mobile: true, status: true } },
          branch: { select: { id: true, name: true } },
        },
      }),
      this.prisma.instructorProfile.count({ where }),
    ]);

    return { rows, total };
  }

  // --------------------------------------------------------------- documents

  listDocuments(instructorId: string) {
    return this.prisma.document.findMany({
      where: {
        ownerType: 'INSTRUCTOR',
        ownerId: instructorId,
        deletedAt: null,
      },
      orderBy: [{ docType: 'asc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * This provider's service offerings, for the admin detail screen — PDF 6.5
   * "review provider service information".
   *
   * Includes the unapproved and the deactivated on purpose: the screen's whole
   * job is to show an administrator what is waiting for approval. Only soft
   * deletes are hidden.
   */
  listOfferings(instructorId: string) {
    return this.prisma.instructorService.findMany({
      where: { instructorId, deletedAt: null },
      select: {
        id: true,
        level: true,
        customPrice: true,
        isActive: true,
        approvedAt: true,
        createdAt: true,
        service: {
          select: {
            id: true,
            name: true,
            basePrice: true,
            durationMin: true,
            isActive: true,
            category: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ approvedAt: 'asc' }, { createdAt: 'asc' }],
    });
  }

  findDocument(instructorId: string, documentId: string) {
    return this.prisma.document.findFirst({
      where: {
        id: documentId,
        ownerType: 'INSTRUCTOR',
        ownerId: instructorId,
        deletedAt: null,
      },
    });
  }

  /**
   * Replaces any existing document of the same type and recomputes the
   * profile's `kycStatus` in the same transaction, so the flag assignment
   * filters on can never disagree with the documents behind it.
   *
   * The old row is soft-deleted, not overwritten: a rejected upload and its
   * remark are evidence if the teacher disputes the decision later.
   */
  replaceDocument(input: {
    instructorId: string;
    docType: string;
    data: Omit<Prisma.DocumentUncheckedCreateInput, 'ownerType' | 'ownerId'>;
    /** Derived by the caller from the documents this write will produce. */
    kycStatus: KycStatus;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.document.updateMany({
        where: {
          ownerType: 'INSTRUCTOR',
          ownerId: input.instructorId,
          docType: input.docType as never,
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      });

      const document = await tx.document.create({
        data: {
          ...input.data,
          ownerType: 'INSTRUCTOR',
          ownerId: input.instructorId,
        },
      });

      await tx.instructorProfile.update({
        where: { id: input.instructorId },
        data: { kycStatus: input.kycStatus },
      });

      return document;
    });
  }

  softDeleteDocument(documentId: string, kycStatus: KycStatus, instructorId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: documentId },
        data: { deletedAt: new Date() },
      });
      await tx.instructorProfile.update({
        where: { id: instructorId },
        data: { kycStatus },
      });
    });
  }

  /** Verification decision plus the recomputed profile flag, atomically. */
  verifyDocument(input: {
    documentId: string;
    instructorId: string;
    verifyStatus: Prisma.DocumentUpdateInput['verifyStatus'];
    verifiedById: string | null;
    remarks?: string;
    kycStatus: KycStatus;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const document = await tx.document.update({
        where: { id: input.documentId },
        data: {
          verifyStatus: input.verifyStatus,
          verifiedById: input.verifiedById,
          verifiedAt: new Date(),
          ...(input.remarks !== undefined && { remarks: input.remarks }),
        },
      });

      await tx.instructorProfile.update({
        where: { id: input.instructorId },
        data: { kycStatus: input.kycStatus },
      });

      return document;
    });
  }

  // ------------------------------------------------------------------ lookup

  branchExists(branchId: string) {
    return this.prisma.branch.findFirst({
      where: { id: branchId, deletedAt: null },
      select: { id: true },
    });
  }

  /**
   * Sessions still ahead of us for this teacher. Suspending someone mid-week
   * leaves customers with a booked session and nobody coming, so ops is told
   * the count before the suspension sticks.
   */
  countUpcomingSessions(instructorId: string) {
    return this.prisma.bookingSession.count({
      where: {
        instructorId,
        deletedAt: null,
        status: {
          in: [
            'CONFIRMED',
            'ASSIGNED',
            'EN_ROUTE',
            'IN_PROGRESS',
            'REASSIGNMENT_NEEDED',
            'RESCHEDULE_REQUESTED',
          ],
        },
      },
    });
  }
}
