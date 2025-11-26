// src/whatsapp/whatsapp.service.ts
import {
  Injectable,
  OnModuleInit,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
  initAuthCreds,
  AuthenticationCreds,
  SignalKeyStore,
} from '@whiskeysockets/baileys';
import { toDataURL } from 'qrcode';
import { Boom } from '@hapi/boom';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';

import { PhoneNumberUtil, PhoneNumberFormat } from 'google-libphonenumber';
import { MessageHandlerService } from './handlers/message-handler.service';

/* -------------------------------------------------------------------------- */
/*                                Buffer JSON                                 */
/* -------------------------------------------------------------------------- */

const BufferJSON = {
  replacer: (key: string, value: any) => {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array || value?.type === 'Buffer') {
      return {
        type: 'Buffer',
        data: Buffer.from(value?.data || value).toString('base64'),
      };
    }
    return value;
  },
  reviver: (key: string, value: any) => {
    if (typeof value === 'object' && value !== null && value.type === 'Buffer') {
      return Buffer.from(value.data, 'base64');
    }
    return value;
  },
};

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

interface WhatsappConnection {
  socket: WASocket | null;
  qr?: string;
  pairingCode?: string;
  status: 'connecting' | 'open' | 'close' | 'error';
  paused?: boolean;
}

type QrTicket = {
  id: string;
  agentId: string;
  dataUrl: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
};

type MediaInput = {
  mimeType: string;
  data: Buffer | Uint8Array | string;
  filename?: string;
  caption?: string;
};

const QR_TTL_MS = 55_000;
const QR_SUGGESTED_REFRESH_MS = 25_000;

@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly baileysLogger = pino({ level: 'silent', enabled: false });
  private connections = new Map<string, WhatsappConnection>();
  private latestQrTicket = new Map<string, QrTicket>();
  private readonly phoneUtil = PhoneNumberUtil.getInstance();

  constructor(
    private readonly prisma: PrismaService,
    private readonly messageHandler: MessageHandlerService,
  ) {
    this.suppressBaileysLogs();
  }

  /* ------------------------------------------------------------------------ */
  /*                          Startup / Log Suppression                       */
  /* ------------------------------------------------------------------------ */

  private suppressBaileysLogs() {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalInfo = console.info;
    const originalDebug = console.debug;

    const shouldSuppress = (args: any[]): boolean => {
      // SAFE string extraction, avoids JSON.stringify (circular refs)
      const text = args
        .map((a) => {
          if (typeof a === 'string') return a;
          if (a && typeof a.message === 'string') return a.message;
          return '';
        })
        .join(' ');

      if (!text) return false;

      return (
        text.includes('Closing stale open session') ||
        text.includes('Closing session') ||
        text.includes('Session error') ||
        text.includes('Failed to decrypt') ||
        text.includes('Bad MAC') ||
        text.includes('privKey:') ||
        text.includes('indexInfo:') ||
        text.includes('chainKey:') ||
        text.includes('SessionEntry') ||
        text.includes('baseKey:') ||
        text.includes('remoteIdentityKey:') ||
        text.includes('registrationId:') ||
        text.includes('currentRatchet:') ||
        text.includes('@whiskeysockets') ||
        text.includes('baileys') ||
        text.includes('libsignal') ||
        text.includes('verifyMAC') ||
        text.includes('SessionCipher') ||
        text.includes('doDecryptWhisperMessage')
      );
    };

    console.log = (...args: any[]) => {
      try {
        if (!shouldSuppress(args)) originalLog.apply(console, args);
      } catch {
        originalLog.apply(console, args);
      }
    };
    console.error = (...args: any[]) => {
      try {
        if (!shouldSuppress(args)) originalError.apply(console, args);
      } catch {
        originalError.apply(console, args);
      }
    };
    console.warn = (...args: any[]) => {
      try {
        if (!shouldSuppress(args)) originalWarn.apply(console, args);
      } catch {
        originalWarn.apply(console, args);
      }
    };
    console.info = (...args: any[]) => {
      try {
        if (!shouldSuppress(args)) originalInfo.apply(console, args);
      } catch {
        originalInfo.apply(console, args);
      }
    };
    console.debug = (...args: any[]) => {
      try {
        if (!shouldSuppress(args)) originalDebug.apply(console, args);
      } catch {
        originalDebug.apply(console, args);
      }
    };
  }

  async onModuleInit() {
    const activeAgents = await this.prisma.agent.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    for (const agent of activeAgents) {
      const session = await this.prisma.whatsapp.findUnique({ where: { agentId: agent.id } });
      if (session && session.sessionData) {
        this.start(agent.id).catch(() => {});
      }
    }
  }

  /* ------------------------------------------------------------------------ */
  /*                                  QR API                                  */
  /* ------------------------------------------------------------------------ */

  async generateQr(agentId: string): Promise<{
    qrId: string;
    qr: string;
    expiresAt: number;
    refreshAfterMs: number;
    status: 'connecting' | 'open' | 'close' | 'error';
  }> {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { isActive: true },
    });
    if (!agent) throw new NotFoundException(`Agent with ID ${agentId} not found.`);
    if (!agent.isActive) {
      const conn = this.ensureConn(agentId);
      conn.paused = true;
      conn.status = 'close';
      throw new BadRequestException('Agent inactive; WhatsApp is paused. Activate the agent to show QR.');
    }

    const status = this.getStatus(agentId);
    if (status === 'open') {
      this.invalidateQrTicket(agentId);
      throw new BadRequestException('Already logged in; QR not available.');
    }

    if (status === 'close' || status === 'error' || !this.connections.get(agentId)?.socket) {
      try {
        const startRes = await this.start(agentId);
        if (startRes.status === 'open') {
          this.invalidateQrTicket(agentId);
          throw new BadRequestException('Already logged in; QR not available.');
        }
      } catch {
        // swallow
      }
    }

    const conn = this.ensureConn(agentId);
    if (!conn.qr) {
      await this.waitForQr(agentId, 10_000);
    }
    if (!conn.qr) {
      throw new BadRequestException('QR not ready yet, try again shortly.');
    }

    const now = Date.now();
    const ticket: QrTicket = {
      id: uuidv4(),
      agentId,
      dataUrl: conn.qr,
      createdAt: now,
      expiresAt: now + QR_TTL_MS,
      used: false,
    };
    this.latestQrTicket.set(agentId, ticket);

    return {
      qrId: ticket.id,
      qr: ticket.dataUrl,
      expiresAt: ticket.expiresAt,
      refreshAfterMs: QR_SUGGESTED_REFRESH_MS,
      status: conn.status || 'connecting',
    };
  }

  async validateQr(agentId: string, qrId: string): Promise<{
    valid: boolean;
    reason?: 'expired' | 'used' | 'mismatch' | 'missing' | 'logged_in';
    expiresAt?: number;
  }> {
    const status = this.getStatus(agentId);
    if (status === 'open') {
      this.invalidateQrTicket(agentId);
      return { valid: false, reason: 'logged_in' };
    }

    const t = this.latestQrTicket.get(agentId);
    if (!t) return { valid: false, reason: 'missing' };
    if (t.id !== qrId) return { valid: false, reason: 'mismatch' };
    if (t.used) return { valid: false, reason: 'used' };
    if (Date.now() > t.expiresAt) return { valid: false, reason: 'expired', expiresAt: t.expiresAt };

    return { valid: true, expiresAt: t.expiresAt };
  }

  async confirmLogin(agentId: string): Promise<{ loggedIn: boolean; status: string }> {
    const status = this.getStatus(agentId);
    if (status === 'open') {
      this.invalidateQrTicket(agentId);
      return { loggedIn: true, status };
    }
    return { loggedIn: false, status };
  }

  getLoginStatus(agentId: string): { status: string; loggedIn: boolean } {
    const status = this.getStatus(agentId);
    return { status, loggedIn: status === 'open' };
  }

  /* ------------------------------------------------------------------------ */
  /*                             Public Send Methods                           */
  /* ------------------------------------------------------------------------ */

  /** Send a plain text message. Accepts a phone number or a JID. */
  async sendText(agentId: string, to: string, text: string): Promise<{ id: string; to: string }> {
    if (!to || !text) {
      throw new BadRequestException('Both "to" and "text" are required.');
    }

    const conn = this.connections.get(agentId);
    if (!conn || conn.paused) {
      throw new NotFoundException('WhatsApp is not connected for this agent');
    }

    const socket = this.getOpenSocket(agentId);
    const jid = this.normalizeToJid(to);

    try {
      if (typeof (socket as any).onWhatsApp === 'function') {
        const results = await (socket as any).onWhatsApp(jid);
        const exists = Array.isArray(results) ? results.some((r: any) => r?.jid === jid && r?.exists) : false;
        if (!exists) throw new BadRequestException(`The number "${to}" is not registered on WhatsApp.`);
      }
    } catch {
      // ignore existence check failure
    }

    const res = await socket.sendMessage(jid, { text });
    const id = (res as any)?.key?.id ?? '';
    return { id, to: jid };
  }

  /** Send media (image / video / document) with an optional caption. */
  async sendMedia(
    agentId: string,
    to: string,
    media: MediaInput,
  ): Promise<{ id: string; to: string; kind: 'image' | 'video' | 'document' }> {
    if (!to || !media?.mimeType || !media?.data) {
      throw new BadRequestException('"to", "mimeType" and "data" are required to send media.');
    }

    const socket = this.getOpenSocket(agentId);
    const jid = this.normalizeToJid(to);

    try {
      if (typeof (socket as any).onWhatsApp === 'function') {
        const results = await (socket as any).onWhatsApp(jid);
        const exists = Array.isArray(results) ? results.some((r: any) => r?.jid === jid && r?.exists) : false;
        if (!exists) throw new BadRequestException(`The number "${to}" is not registered on WhatsApp.`);
      }
    } catch {
      // ignore
    }

    const buffer = this.ensureBuffer(media.data);
    const kind = this.detectMediaKind(media.mimeType);

    let content: any;
    if (kind === 'image') {
      content = { image: buffer, caption: media.caption };
    } else if (kind === 'video') {
      content = { video: buffer, caption: media.caption };
    } else {
      content = {
        document: buffer,
        mimetype: media.mimeType,
        fileName: media.filename || 'file',
        caption: media.caption,
      };
    }

    const res = await socket.sendMessage(jid, content);
    const id = (res as any)?.key?.id ?? '';
    return { id, to: jid, kind };
  }

  /** Send media with caption and then an extra follow-up text message. */
  async sendMediaWithExtraText(
    agentId: string,
    to: string,
    media: MediaInput,
    extraText?: string,
  ): Promise<{ mediaId: string; textId?: string; to: string }> {
    const sent = await this.sendMedia(agentId, to, media);
    let textId: string | undefined;
    if (extraText && extraText.trim()) {
      const t = await this.sendText(agentId, to, extraText.trim());
      textId = t.id;
    }
    return { mediaId: sent.id, textId, to: sent.to };
  }

  /* ------------------------------------------------------------------------ */
  /*                              Session Control                              */
  /* ------------------------------------------------------------------------ */

  async start(agentId: string): Promise<{ qr?: string; status: string; message: string }> {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId }, select: { isActive: true } });
    if (!agent) throw new NotFoundException(`Agent with ID ${agentId} not found.`);
    if (!agent.isActive) {
      const conn = this.ensureConn(agentId);
      conn.paused = true;
      conn.status = 'close';
      return { status: 'close', message: 'Agent inactive; WhatsApp is paused. Activate the agent to start.' };
    }

    const existingConnection = this.connections.get(agentId);
    if (existingConnection && existingConnection.status !== 'close' && !existingConnection.paused) {
      return {
        qr: existingConnection.qr,
        status: existingConnection.status,
        message: 'Connection process is already underway.',
      };
    }

    const conn = this.ensureConn(agentId);
    conn.socket = null;
    conn.status = 'connecting';
    conn.paused = false;

    return new Promise(async (resolve, reject) => {
      let promiseHandled = false;
      try {
        const whatsappRecord = await this.prisma.whatsapp.findUnique({ where: { agentId } });

        let creds: AuthenticationCreds;
        let keys: Record<string, any> = {};

        if (whatsappRecord?.sessionData && typeof whatsappRecord.sessionData === 'string') {
          const sessionData = JSON.parse(whatsappRecord.sessionData, BufferJSON.reviver);
          creds = sessionData.creds;
          keys = sessionData.keys;
        } else {
          creds = initAuthCreds();
        }

        const saveState = async () => {
          const sessionToSave = { creds, keys };
          const sessionString = JSON.stringify(sessionToSave, BufferJSON.replacer);
          await this.prisma.whatsapp.upsert({
            where: { agentId },
            create: { agentId, sessionData: sessionString },
            update: { sessionData: sessionString },
          });
        };

        const signalStore: SignalKeyStore = {
          get: (type, ids) =>
            Promise.resolve(
              ids.reduce((acc: { [id: string]: any }, id) => {
                const value = keys[`${type}-${id}`];
                if (value) acc[id] = value;
                return acc;
              }, {}),
            ),
          set: (data) => {
            for (const type in data) {
              const typeData = (data as any)[type];
              if (typeData) {
                for (const id in typeData) {
                  keys[`${type}-${id}`] = typeData[id];
                }
              }
            }
            return Promise.resolve();
          },
        };

        const { version } = await fetchLatestBaileysVersion();
        const socket = makeWASocket({
          version,
          printQRInTerminal: false,
          auth: { creds, keys: makeCacheableSignalKeyStore(signalStore, this.baileysLogger) },
          logger: this.baileysLogger,
        });

        const connInMap = this.connections.get(agentId);
        if (connInMap) {
          connInMap.socket = socket;
        } else {
          const error = new Error('Connection could not be established in map.');
          socket.end(error);
          if (!promiseHandled) {
            promiseHandled = true;
            return reject(error);
          }
          return;
        }

        socket.ev.on('creds.update', saveState);

        socket.ev.on('connection.update', async (update) => {
          const { connection, lastDisconnect, qr } = update;
          const c = this.connections.get(agentId);
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const reason = statusCode != null ? DisconnectReason[statusCode] : undefined;

          console.log('WA connection.update (start)', {
            agentId,
            connection,
            statusCode,
            reason,
            errorMessage: (lastDisconnect?.error as any)?.message,
          });

          if (!c) return;

          if (qr && !c.paused) {
            const qrDataURL = await toDataURL(qr);
            c.qr = qrDataURL;
            c.status = 'connecting';

            if (!promiseHandled) {
              promiseHandled = true;
              resolve({ qr: qrDataURL, status: 'connecting', message: 'QR code received. Please scan.' });
            }
          }

          if (connection === 'close') {
            // If WhatsApp explicitly logs us out (conflict, etc.), clean up and STOP retrying
            if (statusCode === DisconnectReason.loggedOut) {
              console.error('WA loggedOut (conflict / remote logout)', {
                agentId,
                statusCode,
                reason,
              });

              c.status = 'close';
              c.qr = undefined;

              await this.prisma.whatsapp.update({
                where: { agentId },
                data: { sessionData: Prisma.JsonNull, whatsappJid: null, whatsappName: null },
              });
              this.connections.delete(agentId);
              this.invalidateQrTicket(agentId);

              if (!promiseHandled) {
                promiseHandled = true;
                return reject(
                  new Error(
                    'WhatsApp logged out this session (conflict / remote logout). Clear other sessions or use another number.',
                  ),
                );
              }
              return;
            }

            // Other close reasons → allow retry
            c.status = 'close';
            c.qr = undefined;

            if (!promiseHandled) {
              promiseHandled = true;
              reject(new Error(`Connection closed. Reason: ${reason || 'Unknown'}`));
            }

            if (!c.paused) {
              setTimeout(() => this.start(agentId).catch(() => {}), 5000);
            }
          } else if (connection === 'open') {
            c.status = 'open';
            c.qr = undefined;

            if (socket.user) {
              await this.prisma.agent.update({
                where: { id: agentId },
                data: { isActive: true },
              });
              await this.prisma.whatsapp.update({
                where: { agentId },
                data: { whatsappJid: socket.user.id, whatsappName: socket.user.name },
              });
            }

            this.invalidateQrTicket(agentId);

            if (!promiseHandled) {
              promiseHandled = true;
              resolve({ status: 'open', message: 'Connection successful.' });
            }
          }
        });

        // ------------------ INCOMING MESSAGES: delegate to handler ------------------
        socket.ev.on('messages.upsert', async ({ messages }) => {
          const msg = messages?.[0];
          if (!msg) return;
          const c = this.connections.get(agentId);
          if (c?.paused) return;

          try {
            await this.messageHandler.handleMessage(socket, msg, agentId);
          } catch (err) {
            try {
              await socket.sendMessage(msg.key.remoteJid!, {
                text: 'Sorry, I encountered an error. Please try again later.',
              });
            } catch {}
          }
        });
      } catch (error: any) {
        if (!promiseHandled) {
          promiseHandled = true;
          reject(error);
        }
      }
    });
  }

  async startWithPhone(
    agentId: string,
    phoneNumber: string,
  ): Promise<{ pairingCode?: string; status: string; message: string }> {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId }, select: { isActive: true } });
    if (!agent) throw new NotFoundException(`Agent with ID ${agentId} not found.`);
    if (!agent.isActive) {
      const conn = this.ensureConn(agentId);
      conn.paused = true;
      conn.status = 'close';
      return { status: 'close', message: 'Agent inactive; WhatsApp is paused. Activate the agent to start.' };
    }

    const existingConnection = this.connections.get(agentId);
    if (existingConnection && existingConnection.status !== 'close' && !existingConnection.paused) {
      return {
        pairingCode: existingConnection.pairingCode,
        status: existingConnection.status,
        message: 'Connection process is already underway.',
      };
    }

    const conn = this.ensureConn(agentId);
    conn.socket = null;
    conn.status = 'connecting';
    conn.paused = false;

    return new Promise(async (resolve, reject) => {
      let promiseHandled = false;

      try {
        const whatsappRecord = await this.prisma.whatsapp.findUnique({ where: { agentId } });

        let creds: AuthenticationCreds;
        let keys: Record<string, any> = {};
        const hasSavedSession = !!(whatsappRecord?.sessionData && typeof whatsappRecord.sessionData === 'string');

        if (hasSavedSession) {
          const sessionData = JSON.parse(whatsappRecord.sessionData as string, BufferJSON.reviver);
          creds = sessionData.creds;
          keys = sessionData.keys;
        } else {
          creds = initAuthCreds();
        }

        const saveState = async () => {
          const sessionToSave = { creds, keys };
          const sessionString = JSON.stringify(sessionToSave, BufferJSON.replacer);
          await this.prisma.whatsapp.upsert({
            where: { agentId },
            create: { agentId, sessionData: sessionString },
            update: { sessionData: sessionString },
          });
        };

        const signalStore: SignalKeyStore = {
          get: (type, ids) =>
            Promise.resolve(
              ids.reduce((acc: { [id: string]: any }, id) => {
                const value = keys[`${type}-${id}`];
                if (value) acc[id] = value;
                return acc;
              }, {}),
            ),
          set: (data) => {
            for (const type in data) {
              const typeData = (data as any)[type];
              if (typeData) {
                for (const id in typeData) {
                  keys[`${type}-${id}`] = typeData[id];
                }
              }
            }
            return Promise.resolve();
          },
        };

        const { version } = await fetchLatestBaileysVersion();
        const socket = makeWASocket({
          version,
          printQRInTerminal: false,
          auth: { creds, keys: makeCacheableSignalKeyStore(signalStore, this.baileysLogger) },
          logger: this.baileysLogger,
        });

        const connInMap = this.connections.get(agentId);
        if (connInMap) {
          connInMap.socket = socket;
        } else {
          const error = new Error('Connection could not be established in map.');
          socket.end(error);
          if (!promiseHandled) {
            promiseHandled = true;
            return reject(error);
          }
          return;
        }

        socket.ev.on('creds.update', saveState);

        socket.ev.on('connection.update', async (update) => {
          const { connection, lastDisconnect, qr } = update;
          const c = this.connections.get(agentId);
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const reason = statusCode != null ? DisconnectReason[statusCode] : undefined;

          console.log('WA connection.update (startWithPhone)', {
            agentId,
            connection,
            statusCode,
            reason,
            errorMessage: (lastDisconnect?.error as any)?.message,
          });

          if (!c) return;

          if (qr && !c.paused) {
            const qrDataURL = await toDataURL(qr);
            c.qr = qrDataURL;
            c.status = 'connecting';
            if (!promiseHandled) {
              promiseHandled = true;
              resolve({ status: 'connecting', message: 'QR code received. Please scan.' });
            }
          }

          if (connection === 'close') {
            if (statusCode === DisconnectReason.loggedOut) {
              console.error('WA loggedOut (conflict / remote logout) [startWithPhone]', {
                agentId,
                statusCode,
                reason,
              });

              c.status = 'close';
              c.qr = undefined;
              c.pairingCode = undefined;

              await this.prisma.whatsapp.update({
                where: { agentId },
                data: { sessionData: Prisma.JsonNull, whatsappJid: null, whatsappName: null },
              });
              this.connections.delete(agentId);
              this.invalidateQrTicket(agentId);

              if (!promiseHandled) {
                promiseHandled = true;
                return reject(
                  new Error(
                    'WhatsApp logged out this session (conflict / remote logout). Clear other sessions or use another number.',
                  ),
                );
              }
              return;
            }

            c.status = 'close';
            c.qr = undefined;
            c.pairingCode = undefined;

            if (!promiseHandled) {
              promiseHandled = true;
              reject(new Error(`Connection closed. Reason: ${reason || 'Unknown'}`));
            }

            if (!c.paused) {
              setTimeout(() => this.startWithPhone(agentId, phoneNumber).catch(() => {}), 5000);
            }
          } else if (connection === 'open') {
            c.status = 'open';
            c.qr = undefined;
            c.pairingCode = undefined;

            if (socket.user) {
              await this.prisma.agent.update({
                where: { id: agentId },
                data: { isActive: true },
              });
              await this.prisma.whatsapp.update({
                where: { agentId },
                data: { whatsappJid: socket.user.id, whatsappName: socket.user.name },
              });
            }

            this.invalidateQrTicket(agentId);

            if (!promiseHandled) {
              promiseHandled = true;
              resolve({ status: 'open', message: 'Connection successful.' });
            }
          }
        });

        // ------------------ INCOMING MESSAGES: delegate to handler ------------------
        socket.ev.on('messages.upsert', async ({ messages }) => {
          const msg = messages?.[0];
          if (!msg) return;
          const c = this.connections.get(agentId);
          if (c?.paused) return;

          try {
            await this.messageHandler.handleMessage(socket, msg, agentId);
          } catch {
            try {
              await socket.sendMessage(msg.key.remoteJid!, {
                text: 'Sorry, I encountered an error. Please try again later.',
              });
            } catch {}
          }
        });

        if (!hasSavedSession) {
          try {
            const normalized = this.normalizePairingPhone(phoneNumber);
            const code = await (socket as any).requestPairingCode(normalized);
            const c2 = this.connections.get(agentId);
            if (c2) {
              c2.pairingCode = code;
              c2.status = 'connecting';
            }
            if (!promiseHandled) {
              promiseHandled = true;
              return resolve({
                pairingCode: code,
                status: 'connecting',
                message:
                  'Pairing code generated. On your phone: WhatsApp → Linked devices → Link with phone number → Enter this code.',
              });
            }
          } catch (e: any) {
            if (!promiseHandled) {
              promiseHandled = true;
              return reject(new Error(e?.message || 'Failed to generate pairing code.'));
            }
          }
        }
      } catch (error: any) {
        if (!promiseHandled) {
          promiseHandled = true;
          reject(error);
        }
      }
    });
  }

  getStatus(agentId: string): string {
    return this.connections.get(agentId)?.status || 'disconnected';
  }

  async logout(agentId: string) {
    const conn = this.connections.get(agentId);
    if (conn?.socket) {
      await conn.socket.logout();
    }
  }

  async toggleAgentStatus(agentId: string, isActive: boolean) {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      throw new NotFoundException(`Agent with ID ${agentId} not found.`);
    }

    const updated = await this.prisma.agent.update({
      where: { id: agentId },
      data: { isActive },
    });

    if (!isActive) {
      await this.pauseAgentSession(agentId);
    } else {
      const conn = this.connections.get(agentId);
      if (!conn || conn.status !== 'open') {
        await this.start(agentId).catch(() => {});
      } else {
        conn.paused = false;
      }
    }

    return updated;
  }

  /** Legacy helper; prefer `sendText` */
  async sendMessage(agentId: string, toPhone: string, text: string): Promise<{ to: string; messageId: string }> {
    if (!toPhone || !text) {
      throw new BadRequestException('Both "toPhone" and "text" are required.');
    }

    const agent = await this.prisma.agent.findUnique({ where: { id: agentId }, select: { isActive: true } });
    if (!agent) throw new NotFoundException(`Agent with ID ${agentId} not found.`);
    if (!agent.isActive) {
      throw new BadRequestException('Agent is inactive; messaging is disabled.');
    }

    const conn = this.connections.get(agentId);
    if (conn?.paused) {
      throw new BadRequestException('WhatsApp session is paused; activate the agent to resume messaging.');
    }

    const socket = this.getOpenSocket(agentId);
    const jid = this.phoneToJid(toPhone);

    try {
      if (typeof (socket as any).onWhatsApp === 'function') {
        const results = await (socket as any).onWhatsApp(jid);
        const exists = Array.isArray(results) ? results.some((r: any) => r?.jid === jid && r?.exists) : false;
        if (!exists) {
          throw new BadRequestException(`The number ${toPhone} is not registered on WhatsApp.`);
        }
      }
    } catch {
      // ignore check
    }

    const sent = await socket.sendMessage(jid, { text });
    const messageId = sent?.key?.id || '';

    return { to: jid, messageId };
  }

  async enforceAgentActivePolicy(agentId: string): Promise<{ isActive: boolean; status: string; paused: boolean }> {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId }, select: { isActive: true } });
    if (!agent) throw new NotFoundException(`Agent with ID ${agentId} not found.`);

    if (!agent.isActive) {
      await this.pauseAgentSession(agentId);
      const c = this.ensureConn(agentId);
      return { isActive: false, status: c.status, paused: !!c.paused };
    } else {
      const c = this.connections.get(agentId);
      if (!c || c.status !== 'open') {
        await this.start(agentId).catch(() => {});
      } else {
        c.paused = false;
      }
      const c2 = this.ensureConn(agentId);
      return { isActive: true, status: c2.status, paused: !!c2.paused };
    }
  }

  /* ------------------------------------------------------------------------ */
  /*                                  Utils                                   */
  /* ------------------------------------------------------------------------ */

  private ensureConn(agentId: string): WhatsappConnection {
    let conn = this.connections.get(agentId);
    if (!conn) {
      conn = { socket: null, status: 'close', paused: false };
      this.connections.set(agentId, conn);
    }
    return conn;
  }

  private async pauseAgentSession(agentId: string) {
    const conn = this.ensureConn(agentId);
    conn.paused = true;
    if (conn.socket) {
      try {
        conn.socket.end(new Error('paused-by-admin'));
      } catch {}
    }
    conn.status = 'close';
    conn.qr = undefined;
    conn.pairingCode = undefined;
    this.invalidateQrTicket(agentId);
  }

  private getOpenSocket(agentId: string): WASocket {
    const conn = this.connections.get(agentId);
    if (!conn || !conn.socket) {
      throw new NotFoundException(`No active WhatsApp session for agent ${agentId}. Start it first.`);
    }
    if (conn.status !== 'open') {
      throw new BadRequestException(`WhatsApp session for agent ${agentId} is not open (status: ${conn.status}).`);
    }
    return conn.socket;
  }

  private toE164Digits(raw: string): string {
    if (!raw) throw new BadRequestException('Empty phone number.');

    const DEFAULT_REGION = (process.env.WHATSAPP_DEFAULT_REGION || 'US').toUpperCase();
    const DEFAULT_CC = (process.env.WHATSAPP_DEFAULT_CC || '').replace(/[^\d]/g, '');

    try {
      const num = this.phoneUtil.parseAndKeepRawInput(String(raw), DEFAULT_REGION);
      if (!this.phoneUtil.isValidNumber(num)) throw new Error('Invalid number.');
      const e164 = this.phoneUtil.format(num, PhoneNumberFormat.E164);
      return e164.replace(/^\+/, '');
    } catch {
      let s = String(raw).trim();
      s = s.replace(/[\s().-]/g, '');
      if (s.startsWith('+')) s = s.slice(1);
      else if (s.startsWith('00')) s = s.slice(2);
      else if (s.startsWith('011')) s = s.slice(3);
      s = s.replace(/[^\d]/g, '');
      if (DEFAULT_CC && s && !s.startsWith(DEFAULT_CC) && s.length <= 12) s = DEFAULT_CC + s;
      if (!/^\d{6,18}$/.test(s)) {
        throw new BadRequestException(
          `Invalid phone format: "${raw}". Provide a valid international number (e.g., +14155552671).`,
        );
      }
      return s;
    }
  }

  private phoneToJid(phone: string): string {
    const digits = this.toE164Digits(phone);
    return `${digits}@s.whatsapp.net`;
  }

  private normalizePairingPhone(input: string): string {
    return this.toE164Digits(input);
  }

  private invalidateQrTicket(agentId: string) {
    const t = this.latestQrTicket.get(agentId);
    if (t) {
      t.used = true;
      this.latestQrTicket.set(agentId, t);
    }
  }

  private async waitForQr(agentId: string, timeoutMs: number) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const qr = this.connections.get(agentId)?.qr;
      if (qr) return;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  private isJid(input: string): boolean {
    return /@s\.whatsapp\.net$|@g\.us$/.test(input);
  }

  private normalizeToJid(to: string): string {
    return this.isJid(to) ? to : this.phoneToJid(to);
  }

  private ensureBuffer(data: Buffer | Uint8Array | string): Buffer {
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof Uint8Array) return Buffer.from(data);
    const s = String(data);
    const dataUrlMatch = s.match(/^data:([a-zA-Z0-9\-+/.]+);base64,(.*)$/);
    if (dataUrlMatch) return Buffer.from(dataUrlMatch[2], 'base64');
    const maybeBase64 = s.replace(/\s/g, '');
    try {
      return Buffer.from(maybeBase64, 'base64');
    } catch {
      throw new BadRequestException('Invalid media data; expected Buffer, Uint8Array, base64 string, or data URL.');
    }
  }

  private detectMediaKind(mimeType: string): 'image' | 'video' | 'document' {
    const mt = (mimeType || '').toLowerCase();
    if (mt.startsWith('image/')) return 'image';
    if (mt.startsWith('video/')) return 'video';
    return 'document';
  }
}
