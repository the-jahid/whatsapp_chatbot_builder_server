// ===================================================
// Free Tools Module - Public Landing Page Tools
// ===================================================
import { Module } from '@nestjs/common';
import { FreeToolsController } from './free-tools.controller';
import { FreeToolsService } from './free-tools.service';
import { WhatsappModule } from 'src/agentModules/whatsapp/whatsapp.module';

@Module({
    imports: [WhatsappModule],
    controllers: [FreeToolsController],
    providers: [FreeToolsService],
    exports: [FreeToolsService],
})
export class FreeToolsModule { }
