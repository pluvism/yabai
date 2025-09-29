import {
    WAMessage,
    WASocket,
    downloadMediaMessage,
    proto,
    getContentType,
    jidNormalizedUser,
    areJidsSameUser,
    extractMessageContent
} from 'baileys'
import { Readable } from 'stream'

export class Msg {
    public id: string
    public chat: string
    public sender: string
    public isGroup: boolean
    public fromMe: boolean
    public type: string | undefined
    public body: string
    public mentions: string[]
    public quoted: Msg | null
    public raw: WAMessage

    private sock: WASocket

    constructor(raw: WAMessage, sock: WASocket) {
        this.raw = raw
        this.sock = sock

        this.id = raw.key.id!
        this.chat = jidNormalizedUser(raw.key.remoteJid!)
        this.isGroup = this.chat.endsWith('@g.us')
        this.sender = jidNormalizedUser(
            raw.key.participant || raw.key.remoteJid!
        )
        this.fromMe =
            raw.key.fromMe ||
            areJidsSameUser(this.sender, jidNormalizedUser(sock.user?.id!))

        const message = this.parseMessage(raw.message)
        this.type = message ? getContentType(message) : undefined
        this.body = this.getBody(message)

        this.mentions = []
        const contextInfo = this.getContextInfo(message)
        if (contextInfo?.mentionedJid) {
            this.mentions = contextInfo.mentionedJid
        }

        this.quoted = null
        if (contextInfo?.quotedMessage) {
            const fullQuotedMsg: WAMessage = {
                key: {
                    remoteJid: this.chat,
                    id: contextInfo.stanzaId!,
                    participant: contextInfo.participant
                },
                message: contextInfo.quotedMessage
            }
            this.quoted = new Msg(fullQuotedMsg, sock)
        }
    }

    private parseMessage(
        message: proto.IMessage | null | undefined
    ): proto.IMessage | undefined {
        return message || undefined
    }

    private getBody(message: proto.IMessage | null | undefined): string {
        return (
            message?.conversation ||
            message?.extendedTextMessage?.text ||
            message?.imageMessage?.caption ||
            message?.videoMessage?.caption ||
            ''
        )
    }

    private getContextInfo(
        message: proto.IMessage | null | undefined
    ): proto.IContextInfo | undefined {
        if (!message) return undefined
        const contextInfo =
            message.extendedTextMessage?.contextInfo ||
            message.imageMessage?.contextInfo ||
            message.videoMessage?.contextInfo
        return contextInfo || undefined
    }

    async download(): Promise<Buffer | Readable> {
        return downloadMediaMessage(this.raw, 'buffer', {})
    }

    async reply(text: string): Promise<proto.WebMessageInfo | undefined> {
        return this.sock.sendMessage(this.chat, { text }, { quoted: this.raw })
    }
}

export function serialize(msg: WAMessage, sock: WASocket): Msg {
    return new Msg(msg, sock)
}
