import { Yabai, z } from '../src/index.js'


const bot = new Yabai()


bot
  .on('request', (ctx) => {
    console.log(`[Request] Incoming message from ${ctx.msg.sender}: ${ctx.msg.body}`)
  })
  .cmd('ping', async ({ msg }) => {
    await msg.reply('pong!')
  }, { description: 'Responds with pong' })
  .cmd('echo :text', async ({ params, msg }) => {
    await msg.reply(params.text)
  }, { description: 'Echoes the given text' })
  .cmd('sum :a :b', z.object({ a: z.coerce.number(), b: z.coerce.number() }), async ({ params, msg }) => {
    await msg.reply(`The sum is ${params.a + params.b}`)
  }, { description: 'Calculates the sum of two numbers' })


bot.connect().catch(err => console.error(err))

console.log('Baileys bot starting...')
console.log('Please scan the QR code with your WhatsApp.')