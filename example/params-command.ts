import { Yabai, t } from '../src/index.js'

const bot = new Yabai({
    pairing: { number: '827372324' } //change this to your number
})

bot.cmd(
    'sum :a :b',
    t.object({ a: t.number(), b: t.number() }),
    async ({ params, msg }) => {
        await msg.reply(`The sum is ${params.a + params.b}`) // params.a and params.b is a number
    }
)

bot.connect().catch((err) => console.error(err))
