// ===================================================
// src/agent/agent.module.ts
// ===================================================
import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { UserModule } from 'src/user/user.module';

@Module({
  imports: [
    UserModule,   // provides UserService (used in AgentController)
  ],
  controllers: [AgentController],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule { }
