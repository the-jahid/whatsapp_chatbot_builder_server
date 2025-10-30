// src/whatsapp/message-handler.service.ts
import { Injectable } from '@nestjs/common';
import type { WAMessage, WASocket } from '@whiskeysockets/baileys';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { PrismaService } from 'src/prisma/prisma.service';
import { MemoryType, SenderType } from '@prisma/client';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { RunAgentService } from './run-agent.service';

import OpenAI from 'openai';
import { toFile } from 'openai/uploads';

@Injectable()
export class MessageHandlerService {
  // ---------- OpenAI (optional) ----------
  private readonly openaiEnabled = !!process.env.OPENAI_API_KEY;
  private readonly openai = this.openaiEnabled ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

  private readonly openaiResponseModel = process.env.OPENAI_RESPONSE_MODEL || 'gpt-4o-mini';
  private readonly openaiTtsModel = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
  private readonly openaiTtsVoice = process.env.OPENAI_TTS_VOICE || 'alloy';
  private readonly openaiTranscribeModel = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1'; // or 'gpt-4o-transcribe'

  constructor(
    private readonly prisma: PrismaService,
    private readonly runAgent: RunAgentService,
  ) {}

  /**
   * Main handler for incoming WhatsApp messages (text or voice).
   * - If voice: transcribe via OpenAI, then run agent with BUFFER history.
   * - Replies with text and (if available) TTS audio.
   */
  public async handleMessage(socket: WASocket, msg: WAMessage, agentId: string): Promise<void> {
    const senderJid = msg.key.remoteJid;
    if (!senderJid || msg.key.fromMe || senderJid === 'status@broadcast') return;

    // Extract text if any (from many possible message shapes)
    let incomingText = this.extractText(msg);
    const audioMessage = this.extractAudioMessage(msg);
    const isVoice = !incomingText && !!audioMessage;

    try {
      await this.sendTyping(socket, senderJid);

      // Load agent + settings
      const agent = await this.prisma.agent.findUnique({
        where: { id: agentId },
        select: {
          id: true,
          prompt: true,
          isActive: true,
          memoryType: true,
          historyLimit: true,
        },
      });
      if (!agent || !agent.isActive) return;

      // If it's a voice-only message, transcribe it
      if (isVoice) {
        if (!this.openai || !this.openaiEnabled) {
          await this.safeSendText(socket, senderJid, 'Voice features are disabled (missing OPENAI_API_KEY).');
          return;
        }
        const audioBuf = await this.downloadAudioBuffer(audioMessage!);
        const transcript = await this.transcribeAudio(audioBuf, audioMessage!.mimetype || 'audio/ogg');
        incomingText = transcript?.trim();
      }

      // If no usable text after extraction/transcription, do nothing
      if (!incomingText || !incomingText.trim()) return;

      // Persist HUMAN message
      await this.prisma.conversation.create({
        data: {
          agentId: agent.id,
          senderJid,
          message: incomingText,
          senderType: SenderType.HUMAN,
        },
      });

      const historyLimit = this.clampHistoryLimit(agent.historyLimit);
      const history: BaseMessage[] =
        agent.memoryType === MemoryType.BUFFER
          ? await this.loadHistoryAsLCMsgs(agent.id, senderJid, historyLimit)
          : [];

      // Run the agent with history
      const aiText = await this.runAgent.runAgent(incomingText, history, null, agent.id);

      // Persist AI message
      await this.prisma.conversation.create({
        data: {
          agentId: agent.id,
          senderJid,
          message: aiText,
          senderType: SenderType.AI,
        },
      });

      // Send back text
      await this.safeSendText(socket, senderJid, aiText);

      // If original was voice and TTS is available, synthesize and send audio reply
      if (isVoice && this.openai && this.openaiEnabled) {
        try {
          const { audio: ttsBuf, mimetype, ptt } = await this.synthesizeSpeech(aiText);
          await socket.sendMessage(senderJid, { audio: ttsBuf, mimetype, ptt });
        } catch {
          // TTS failed — text was already sent
        }
      }
    } catch {
      await this.safeSendText(socket, senderJid, 'Sorry, I encountered an error. Please try again later.');
    } finally {
      try {
        await socket.sendPresenceUpdate('paused', senderJid);
      } catch {
        // swallow
      }
    }
  }

  /* ------------------------------------------------------------------------ */
  /*                                Helpers                                   */
  /* ------------------------------------------------------------------------ */

  /**
   * Extract a readable text from a Baileys WAMessage.
   * Handles ephemeral/viewOnce containers and several interactive types.
   */
  private extractText(msg: WAMessage): string | null {
    const container =
      (msg.message as any)?.ephemeralMessage?.message ||
      (msg.message as any)?.viewOnceMessageV2?.message ||
      (msg.message as any);

    const m = container;
    if (!m) return null;

    const text =
      m.conversation ||
      m.extendedTextMessage?.text ||
      m.imageMessage?.caption ||
      m.videoMessage?.caption ||
      m.buttonsResponseMessage?.selectedDisplayText ||
      m.templateButtonReplyMessage?.selectedDisplayText ||
      m.listResponseMessage?.title ||
      m.listResponseMessage?.singleSelectReply?.selectedRowId ||
      null;

    return text ?? null;
  }

  /** Find audioMessage inside possible containers (voice notes). */
  private extractAudioMessage(msg: WAMessage): any | null {
    const container =
      (msg.message as any)?.ephemeralMessage?.message ||
      (msg.message as any)?.viewOnceMessageV2?.message ||
      (msg.message as any);

    return container?.audioMessage || null;
  }

  /** Load last N messages and convert to LangChain BaseMessages (oldest -> newest). */
  private async loadHistoryAsLCMsgs(agentId: string, senderJid: string, limit: number): Promise<BaseMessage[]> {
    const rows = await this.prisma.conversation.findMany({
      where: { agentId, senderJid },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { senderType: true, message: true },
    });

    const chronological = rows.reverse();

    const lc: BaseMessage[] = [];
    for (const row of chronological) {
      if (row.senderType === SenderType.HUMAN) {
        lc.push(new HumanMessage(row.message));
      } else {
        lc.push(new AIMessage(row.message));
      }
    }
    return lc;
  }

  /** Show typing indicator while running */
  private async sendTyping(socket: WASocket, jid: string): Promise<void> {
    try {
      await socket.presenceSubscribe(jid);
      await socket.sendPresenceUpdate('composing', jid);
    } catch {
      // ignore
    }
  }

  /** Safe text send */
  private async safeSendText(socket: WASocket, jid: string, text: string): Promise<void> {
    try {
      await socket.sendMessage(jid, { text });
    } catch {
      // ignore
    }
  }

  /** Clamp history limit to a safe range */
  private clampHistoryLimit(value?: number): number {
    const v = Number.isFinite(value as number) ? (value as number) : 20;
    return Math.max(1, Math.min(v, 100));
    }

  /* ---------------------------- Voice helpers ---------------------------- */

  /** Download audio as Buffer using Baileys helper (works for voice notes). */
  private async downloadAudioBuffer(audioMessage: any): Promise<Buffer> {
    const stream = await downloadContentFromMessage(audioMessage, 'audio');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /** Transcribe user audio to text with OpenAI. */
  private async transcribeAudio(buffer: Buffer, mime: string): Promise<string> {
    if (!this.openai) return '(transcription unavailable)';
    const filename = mime.includes('mpeg') ? 'audio.mp3' : 'audio.ogg';
    const file = await toFile(buffer, filename, { type: mime || 'audio/ogg' });

    const res = await this.openai.audio.transcriptions.create({
      file,
      model: this.openaiTranscribeModel, // 'whisper-1' or 'gpt-4o-transcribe'
    });
    const text = (res as any)?.text || '';
    return text.trim() || '(empty transcription)';
  }

  /**
   * TTS via OpenAI.
   * NOTE: SDK returns MP3 by default. WhatsApp will show it as a normal audio file (not PTT bubble).
   */
  private async synthesizeSpeech(text: string): Promise<{ audio: Buffer; mimetype: string; ptt: boolean }> {
    if (!this.openai) throw new Error('OpenAI not configured');
    const speech = await this.openai.audio.speech.create({
      model: this.openaiTtsModel,
      voice: this.openaiTtsVoice,
      input: text,
    });
    const buf = Buffer.from(await (speech as any).arrayBuffer());
    return { audio: buf, mimetype: 'audio/mpeg', ptt: false };
  }
}
