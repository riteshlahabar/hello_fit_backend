import { Module } from '@nestjs/common';
import { AssignmentModule } from '../assignment/assignment.module';
import { TrainerAppModule } from '../trainer-app/trainer-app.module';
import { InstructorController } from './instructor.controller';
import { SessionAutoCompleteService } from './session-autocomplete.service';
import { SessionService } from './session.service';

@Module({
  imports: [AssignmentModule, TrainerAppModule],
  controllers: [InstructorController],
  providers: [SessionService, SessionAutoCompleteService],
  exports: [SessionService],
})
export class SessionModule {}
