import QRCode from './vendor/QRCode/index.js'
import QRErrorCorrectLevel from './vendor/QRCode/QRErrorCorrectLevel.js'

type GenerateOptions = {
    small?: boolean
}

type GenerateCallback = (qrCode: string) => void

let error: number = QRErrorCorrectLevel.L

const black = '\x1b[40m  \x1b[0m'
const white = '\x1b[47m  \x1b[0m'

function toCell(isBlack: boolean | null): string {
    return isBlack ? black : white
}

function repeat(color: string) {
    return {
        times(count: number): string {
            return new Array(count + 1).join(color)
        }
    }
}

function fill(length: number, value: boolean): boolean[] {
    const arr: boolean[] = new Array(length)
    for (let i = 0; i < length; i++) {
        arr[i] = value
    }
    return arr
}

export function generate(
    input: string,
    opts?: GenerateOptions | GenerateCallback,
    cb?: GenerateCallback
): void {
    let options: GenerateOptions = {}
    let callback: GenerateCallback | undefined

    if (typeof opts === 'function') {
        callback = opts as GenerateCallback
    } else if (opts) {
        options = opts as GenerateOptions
        callback = cb
    }

    const qrcode = new QRCode(-1, error)
    qrcode.addData(input)
    qrcode.make()

    let output = ''
    if (options && options.small) {
        const BLACK = true,
            WHITE = false
        const moduleCount = qrcode.getModuleCount()
        const moduleData = (qrcode.modules || []).slice()

        const oddRow = moduleCount % 2 === 1
        if (oddRow) {
            moduleData.push(fill(moduleCount, WHITE))
        }

        const platte = {
            WHITE_ALL: '\u2588',
            WHITE_BLACK: '\u2580',
            BLACK_WHITE: '\u2584',
            BLACK_ALL: ' '
        }

        const borderTop = repeat(platte.BLACK_WHITE).times(moduleCount + 3)
        const borderBottom = repeat(platte.WHITE_BLACK).times(moduleCount + 3)
        output += borderTop + '\n'

        for (let row = 0; row < moduleCount; row += 2) {
            output += platte.WHITE_ALL

            for (let col = 0; col < moduleCount; col++) {
                const topModule = moduleData[row][col]
                const bottomModule = moduleData[row + 1][col]

                if (topModule === WHITE && bottomModule === WHITE) {
                    output += platte.WHITE_ALL
                } else if (topModule === WHITE && bottomModule === BLACK) {
                    output += platte.WHITE_BLACK
                } else if (topModule === BLACK && bottomModule === WHITE) {
                    output += platte.BLACK_WHITE
                } else {
                    output += platte.BLACK_ALL
                }
            }

            output += platte.WHITE_ALL + '\n'
        }

        if (!oddRow) {
            output += borderBottom
        }
    } else {
        const border = repeat(white).times(qrcode.getModuleCount() + 3)
        output += border + '\n'
        ;(qrcode.modules || []).forEach((row) => {
            output += white
            output += (row.map(toCell) || []).join('')
            output += white + '\n'
        })
        output += border
    }

    if (callback) {
        callback(output)
    } else {
        console.log(output)
    }
}

export function setErrorLevel(errorLevel: 'L' | 'M' | 'Q' | 'H'): void {
    error = QRErrorCorrectLevel[errorLevel] || error
}
