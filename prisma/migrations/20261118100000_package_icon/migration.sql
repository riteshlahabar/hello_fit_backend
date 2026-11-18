-- The card symbol the admin types, as MembershipPlan.icon carried before
-- plans were deleted. Decoration only: null falls back to the card default.
ALTER TABLE "packages" ADD COLUMN "icon" VARCHAR(16);
