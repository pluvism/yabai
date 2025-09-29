import makeWASocket, {
    ConnectionState,
    DisconnectReason,
    useMultiFileAuthState,
    WAMessage,
    WASocket,
} from "baileys";
import { Boom } from "@hapi/boom";
import { Yabai } from "../core/yabai.js";

export async function connect(yabai: Yabai, authPath: string = 'auth_info_baileys') {
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
    });

    yabai.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        yabai.logger.info('connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
        if (shouldReconnect) {
          connect(yabai, authPath);
        }
      } else if (connection === 'open') {
        yabai.logger.info('opened connection');
      }
    });

    sock.ev.on('messages.upsert', async (m: { messages: WAMessage[], type: any }) => {
      const msg = m.messages[0];
      if (!msg.message) return;

      const messageBody = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
      if (!messageBody) return;

      await yabai.handle({
        body: messageBody,
        raw: msg,
      });
    });

    return yabai;
  }