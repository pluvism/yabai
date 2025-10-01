import { ConfigError } from '../src/core/yabai.js'
import { Yabai, t } from '../src/index.js'
import { strict as assert } from 'node:assert'

const tests: { [key: string]: () => Promise<void> } = {}

function test(name: string, fn: () => Promise<void>) {
    tests[name] = fn
}

async function run() {
    const testNames = Object.keys(tests)
    console.log(`Running ${testNames.length} tests...`)
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
    console.log('All tests passed!')
}

const mockSock: any = {
    sendMessage: async (jid: any, content: any, options: any) => {
        return {} as any
    }
}

test('should handle a string handler', async () => {
    const bot = new Yabai()
    let replied = false

    bot.sock = {
        sendMessage: async (jid: any, content: any, options: any) => {
            assert.equal(content.text, 'world!')
            replied = true
            return {} as any
        }
    } as any
    bot.cmd('hello', 'world!')

    await bot.handle({
        body: 'hello',
        raw: { key: { remoteJid: 'test' } } as any
    })
    assert.ok(replied, 'Handler was not called')
})

test('should handle a simple command', async () => {
    const bot = new Yabai()
    let replied = false
    bot.cmd('ping', async ({ msg }) => {
        await msg.reply('pong')
    })

    bot.sock = {
        sendMessage: async (jid: any, content: any, options: any) => {
            assert.equal(content.text, 'pong')
            replied = true
            return {} as any
        }
    } as any

    await bot.handle({
        body: 'ping',
        raw: { key: { remoteJid: 'test' } } as any
    })
    assert.ok(replied, 'Handler was not called')
})

test('should extract parameters correctly', async () => {
    const bot = new Yabai()
    bot.cmd('echo :text', async ({ params, msg }) => {
        await msg.reply(params.text)
    })

    let repliedText = ''
    bot.sock = {
        sendMessage: async (jid: any, content: any, options: any) => {
            repliedText = content.text
            return {} as any
        }
    } as any

    await bot.handle({
        body: 'echo hello world',
        raw: { key: { remoteJid: 'test' } } as any
    })
    assert.equal(repliedText, 'hello world')
})

test('should throw for optional before required', async () => {
    const bot = new Yabai()
    assert.throws(() => {
        bot.cmd('x :a :b', async () => {}, {
            args: t.object({ a: t.number().optional(), b: t.number() })
        })
    }, ConfigError)
})

test('should not throw for required then optional suffix', async () => {
    const bot = new Yabai()
    assert.doesNotThrow(() => {
        bot.cmd('x :a :b', async () => {}, {
            args: t.object({ a: t.number(), b: t.number().optional() })
        })
    })
})

test('should validate with yabai schema', async () => {
    const bot = new Yabai()
    bot.cmd(
        'sum :a :b',
        async ({ params, msg }) => {
            await msg.reply(`Sum is ${params.a + params.b}`)
        },
        {
            args: t.object({ a: t.number(), b: t.number() })
        }
    )

    let repliedText = ''
    bot.sock = {
        sendMessage: async (jid: any, content: any, options: any) => {
            repliedText = content.text
            return {} as any
        }
    } as any

    await bot.handle({
        body: 'sum 10 20',
        raw: { key: { remoteJid: 'test' } } as any
    })
    assert.equal(repliedText, 'Sum is 30')
})

test('should validate with yabai schema default', async () => {
    const bot = new Yabai()
    bot.cmd(
        'hi :name',
        t.object({ name: t.string().default('world!') }),
        async ({ params, msg }) => {
            await msg.reply(`Hello ${params.name}`)
        }
    )

    let repliedText = ''
    bot.sock = {
        sendMessage: async (jid: any, content: any, options: any) => {
            repliedText = content.text
            return {} as any
        }
    } as any

    await bot.handle({
        body: 'hi',
        raw: { key: { remoteJid: 'test' } } as any
    })
    assert.equal(repliedText, 'Hello world!')
})

test('should validate with yabai schema nullable', async () => {
    const bot = new Yabai()
    bot.cmd(
        'weather :name',
        t.object({ name: t.string().nullable() }),
        async ({ params, msg }) => {
            if (params.name === null) {
                await msg.reply('current weather is 30')
            } else {
                await msg.reply(`current weather in ${params.name} is 29`)
            }
        }
    )

    let repliedText = ''
    bot.sock = {
        sendMessage: async (jid: any, content: any, options: any) => {
            repliedText = content.text
            return {} as any
        }
    } as any

    await bot.handle({
        body: 'weather',
        raw: { key: { remoteJid: 'test' } } as any
    })
    assert.equal(repliedText, 'current weather is 30')
})

test('should handle yabai schema validation failure', async () => {
    const bot = new Yabai()
    let replied = false
    bot.cmd(
        'sum :a :b',
        t.object({ a: t.number(), b: t.number() }),
        async ({ params, msg }) => {
            await msg.reply(`Sum is ${params.a + params.b}`)
        }
    )

    bot.onError(async ({ ctx }) => {
        await ctx.msg.reply('Validation error')
    })

    bot.sock = {
        sendMessage: async (jid: any, content: any, options: any) => {
            assert.equal(content.text, 'Validation error')
            replied = true
            return {} as any
        }
    } as any

    await bot.handle({
        body: 'sum a b',
        raw: { key: { remoteJid: 'test' } } as any
    })
    assert.ok(replied, 'Error handler was not called')
})

test('should handle grouped commands', async () => {
    const bot = new Yabai()
    bot.group('admin', (g) => {
        g.cmd('kick :user', async ({ params, msg }) => {
            await msg.reply(`Kicked ${params.user}`)
        })
    })

    let repliedText = ''
    bot.sock = {
        sendMessage: async (jid: any, content: any, options: any) => {
            repliedText = content.text
            return {} as any
        }
    } as any

    await bot.handle({
        body: 'admin kick jules',
        raw: { key: { remoteJid: 'test' } } as any
    })
    assert.equal(repliedText, 'Kicked jules')
})

test('should handle regex commands', async () => {
    const bot = new Yabai()
    bot.cmd(/stic?ker/i, async ({ msg }) => {
        await msg.reply('sticker command')
    })

    let repliedText = ''
    bot.sock = {
        sendMessage: async (jid: any, content: any, options: any) => {
            repliedText = content.text
            return {} as any
        }
    } as any

    await bot.handle({
        body: 'sticker',
        raw: { key: { remoteJid: 'test' } } as any
    })
    assert.equal(repliedText, 'sticker command')

    await bot.handle({
        body: 'stiker',
        raw: { key: { remoteJid: 'test' } } as any
    })
    assert.equal(repliedText, 'sticker command')
})

test('should execute middleware only for cmd scope', async () => {
    const bot = new Yabai()
    let beforeCalled = false
    let afterCalled = false

    bot.cmd(
        'test',
        async ({ msg }) => {
            msg.reply('tested')
        },
        {
            beforeHandle() {
                beforeCalled = true
            },
            afterHandle() {
                afterCalled = true
            }
        }
    )

    bot.sock = mockSock

    await bot.handle({
        body: 'test',
        raw: { key: { remoteJid: 'test' } } as any
    })

    assert.ok(beforeCalled, 'beforeHandle was not called')
    assert.ok(afterCalled, 'afterHandle was not called')
})

test('should execute error middleware', async () => {
    const bot = new Yabai()
    let errorCalled = false

    bot.cmd(
        'test',
        async ({ msg }) => {
            throw 'error'
        },
        {
            error({ error }) {
                errorCalled = true
            }
        }
    )

    bot.sock = mockSock

    await bot.handle({
        body: 'test',
        raw: { key: { remoteJid: 'test' } } as any
    })

    assert.ok(errorCalled, 'error middleware not called')
})

test('should execute middleware', async () => {
    const bot = new Yabai()
    let beforeCalled = false
    let afterCalled = false

    bot.onBeforeHandle(() => {
        beforeCalled = true
    })
    bot.onAfterHandle(() => {
        afterCalled = true
    })

    bot.cmd('test', async ({ msg }) => {
        msg.reply('tested')
    })

    bot.sock = mockSock

    await bot.handle({
        body: 'test',
        raw: { key: { remoteJid: 'test' } } as any
    })

    assert.ok(beforeCalled, 'beforeHandle was not called')
    assert.ok(afterCalled, 'afterHandle was not called')
})

test('should not inherit middleware on local scope', async () => {
    let beforeCalled = false
    let imageCalled = 0
    let repliedPing = false
    class CustomError extends Error {
        constructor(message: string) {
            super(message)
            this.name = 'CustomError'
        }
    }
    const image = new Yabai()
    image
        .onBeforeHandle(async (ctx) => {
            beforeCalled = true
            if (ctx.msg.type !== 'imageMessage') {
                return 'not an image message'
            }
        })
        .cmd('image', ({ msg }) => {
            imageCalled += 1
            assert.ok(
                msg.type === 'imageMessage',
                'message type not a imageMessage'
            )
        })

    const bot = new Yabai()
    bot.use(image).cmd('ping', async ({ msg }) => {
        await msg.reply('Pong!')
    })

    bot.sock = {
        sendMessage: async (jid: any, content: any, options: any) => {
            assert.equal(content.text, 'Pong!')
            repliedPing = true
            return {} as any
        }
    } as any

    

    await bot.handle({
        body: 'image',
        raw: {
            key: { remoteJid: 'test' },
            message: {
                imageMessage: {}
            }
        } as any
    })
    assert.ok(beforeCalled, 'onBeforeHandle not called')
    assert.ok(imageCalled === 1, 'image command not called')

    await bot.handle({
        body: 'ping',
        raw: { key: { remoteJid: 'test' } }
    })

    assert.ok(repliedPing, 'ping not called')


    await bot.handle({
            body: 'image',
            raw: { key: { remoteJid: 'test' } }
        })

    assert.ok(imageCalled === 1, 'image called on non-imageMessage')
})

test('should execute hooks', async () => {
    const bot = new Yabai()
    let requestHookCalled = false

    bot.onRequest(() => {
        requestHookCalled = true
    })

    bot.cmd('hooktest', async ({ msg }) => {
        msg.reply('hooked')
    })

    bot.sock = mockSock

    await bot.handle({
        body: 'hooktest',
        raw: { key: { remoteJid: 'test' } } as any
    })

    assert.ok(requestHookCalled, 'onRequest hook was not called')
})

test('should not reply for unknown commands', async () => {
    const bot = new Yabai()
    bot.cmd('known', ({ msg }) => msg.reply('known'))

    let replied = false
    bot.sock = {
        sendMessage: async () => {
            replied = true
            return {} as any
        }
    } as any

    await bot.handle({
        body: 'unknown',
        raw: { key: { remoteJid: 'test' } } as any
    })

    assert.ok(!replied, 'Replied for an unknown command')
})

test('should handle plugins with prefixes and middleware', async () => {
    const plugin = new Yabai()
    plugin.cmd('plug', ({ msg }) => msg.reply('plugged'))

    const bot = new Yabai()
    let middlewareCalled = false
    bot.group('admin', (g) => {
        g.onBeforeHandle(() => {
            middlewareCalled = true
        })
        g.use(plugin, { prefix: 'p' })
    })

    let replied = false
    bot.sock = {
        sendMessage: async (jid: any, content: any, options: any) => {
            assert.equal(content.text, 'plugged')
            replied = true
            return {} as any
        }
    } as any
    await bot.handle({
        body: 'admin p plug',
        raw: { key: { remoteJid: 'test' } } as any
    })

    assert.ok(replied, 'Plugin command was not called')
    assert.ok(middlewareCalled, 'Group middleware was not called for plugin')
})

test('should handle a predicate with hears()', async () => {
    const bot = new Yabai()
    let replied = false

    bot.hears(
        (msg) => msg.message?.conversation === 'hello there',
        async ({ msg }) => {
            await msg.reply('General Kenobi!')
        }
    )

    bot.sock = {
        sendMessage: async (jid: any, content: any, options: any) => {
            assert.equal(content.text, 'General Kenobi!')
            replied = true
            return {} as any
        }
    } as any

    await bot.handle({
        body: 'hello there',
        raw: {
            message: { conversation: 'hello there' },
            key: { remoteJid: 'test' }
        } as any
    })

    assert.ok(replied, 'Hears handler was not called for matching message')

    // Test that it doesn't trigger for non-matching messages
    replied = false
    bot.sock = {
        sendMessage: async () => {
            replied = true
            return {} as any
        }
    } as any
    await bot.handle({
        body: 'goodbye there',
        raw: {
            message: { conversation: 'goodbye there' },
            key: { remoteJid: 'test' }
        } as any
    })
    assert.ok(!replied, 'Hears handler was called for non-matching message')
})

test('should generate help message', async () => {
    const bot = new Yabai({ enableHelp: true })
    bot.cmd('ping', ({ msg }) => msg.reply('pong'), {
        description: 'A simple ping command'
    })
    bot.cmd('foo', ({ msg }) => msg.reply('bar'))

    let repliedText = ''
    bot.sock = {
        sendMessage: async (jid: any, content: any, options: any) => {
            repliedText = content.text
            return {} as any
        }
    } as any

    await bot.handle({
        body: 'help',
        raw: { key: { remoteJid: 'test' } } as any
    })

    assert.ok(
        repliedText.includes('*Available Commands:*'),
        'Help message should have a title'
    )
    assert.ok(
        repliedText.includes('ping: A simple ping command'),
        'Help message should include ping command'
    )
    assert.ok(
        repliedText.includes('foo: No description'),
        'Help message should include foo command with default description'
    )
    assert.ok(
        repliedText.includes('help: Displays this help message'),
        'Help message should include itself'
    )
})

run()
