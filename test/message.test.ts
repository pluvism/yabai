import { strict as assert } from 'node:assert'
import { serialize } from '../src/core/message.js'

const tests: { [key: string]: () => Promise<void> } = {}

function test(name: string, fn: () => void) {
    tests[name] = async () => fn()
}

async function run() {
    const testNames = Object.keys(tests)
    console.log(`Running ${testNames.length} tests for Msg class...`)
    for (const name of testNames) {
        try {
            await tests[name]()
            console.log(`✔ ${name}`)
        } catch (e) {
            console.error(`✖ ${name}`)
            console.error(e)
            process.exit(1)
        }
    }
    console.log('All Msg tests passed!')
}

const mockSock: any = {
    user: { id: 'bot@s.whatsapp.net' },
    sendMessage: async (jid: any, content: any, options: any) => {
        return { jid, content, options }
    }
}

test('should get body from conversation', () => {
    const raw = {
        key: { remoteJid: 'chat@s.whatsapp.net' },
        message: { conversation: 'hello' }
    } as any
    const msg = serialize(raw, mockSock)
    assert.equal(msg.body, 'hello')
})

test('should get body from extendedTextMessage', () => {
    const raw = {
        key: { remoteJid: 'chat@s.whatsapp.net' },
        message: { extendedTextMessage: { text: 'hello ext' } }
    } as any
    const msg = serialize(raw, mockSock)
    assert.equal(msg.body, 'hello ext')
})

test('should get sender for personal chat', () => {
    const raw = {
        key: { remoteJid: '123@s.whatsapp.net' },
        message: {}
    } as any
    const msg = serialize(raw, mockSock)
    assert.equal(msg.sender, '123@s.whatsapp.net')
})

test('should get sender for group chat', () => {
    const raw = {
        key: { remoteJid: 'group@g.us', participant: '456@s.whatsapp.net' },
        message: {}
    } as any
    const msg = serialize(raw, mockSock)
    assert.equal(msg.sender, '456@s.whatsapp.net')
})

test('should identify group chat', () => {
    const raw = {
        key: { remoteJid: 'group@g.us' },
        message: {}
    } as any
    const msg = serialize(raw, mockSock)
    assert.ok(msg.isGroup)
})

test('should get quoted message with correct sender', () => {
    const raw = {
        key: { remoteJid: 'group@g.us', participant: '123@s.whatsapp.net' },
        message: {
            extendedTextMessage: {
                text: 'this is a reply',
                contextInfo: {
                    quotedMessage: { conversation: 'the original message' },
                    stanzaId: 'ABC',
                    participant: '456@s.whatsapp.net' // The original sender
                }
            }
        }
    } as any
    const msg = serialize(raw, mockSock)
    assert.ok(msg.quoted, 'Quoted message should exist')
    assert.equal(msg.quoted?.body, 'the original message')
    assert.equal(
        msg.quoted?.sender,
        '456@s.whatsapp.net',
        'Quoted sender should be the participant from contextInfo'
    )
})

test('should get mentions', () => {
    const raw = {
        key: { remoteJid: 'chat@s.whatsapp.net' },
        message: {
            extendedTextMessage: {
                text: 'hello @1234567890',
                contextInfo: {
                    mentionedJid: ['1234567890@s.whatsapp.net']
                }
            }
        }
    } as any
    const msg = serialize(raw, mockSock)
    assert.deepStrictEqual(msg.mentions, ['1234567890@s.whatsapp.net'])
})

test('reply method should call sendMessage with correct jid', async () => {
    let called = false
    const sock = {
        ...mockSock,
        sendMessage: async (jid: any, content: any, options: any) => {
            assert.equal(jid, 'group@g.us')
            assert.deepStrictEqual(content, { text: 'response' })
            called = true
            return {} as any
        }
    }
    const raw = {
        key: { remoteJid: 'group@g.us', participant: '123@s.whatsapp.net' },
        message: {}
    } as any
    const msg = serialize(raw, sock as any)
    await msg.reply('response')
    assert.ok(called, 'sendMessage was not called')
})

run()
