import { Module } from '@nestjs/common';
import { AssignmentModule } from '../assignment/assignment.module';
import { PaymentModule } from '../payment/payment.module';
import { TrainerAppModule } from '../trainer-app/trainer-app.module';
import { InstructorController } from './instructor.controller';
import { SessionActionsController } from './session-actions.controller';
import { SessionActionsService } from './session-actions.service';
import { SessionAutoCompleteService } from './session-autocomplete.service';
import { SessionService } from './session.service';

@Module({
  imports: [AssignmentModule, TrainerAppModule, PaymentModule],
  controllers: [InstructorController, SessionActionsController],
  providers: [SessionService, SessionAutoCompleteService, SessionActionsService],
  exports: [SessionService],
})
export class SessionModule {}
