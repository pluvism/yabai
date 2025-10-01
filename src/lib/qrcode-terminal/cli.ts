#!/usr/bin/env node

import * as qrcode from './main.js'
import * as path from 'path'
import * as fs from 'fs'

const name = 'qrcode-terminal'

function help() {
    console.log(
        [
            '',
            `Usage: ${name} <message>`,
            '',
            'Options:',
            '  -h, --help           output usage information',
            '  -v, --version        output version number',
            '',
            'Examples:',
            '',
            `  $ ${name} hello`,
            `  $ ${name} "hello world"`,
            ''
        ].join('\n')
    )
}

function version() {
    const packagePath = path.join(__dirname, '..', 'package.json')
    const packageJSON = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
    console.log(packageJSON.version)
}

function handleInput(input: string) {
    if (!input || input === '-h' || input === '--help') {
        help()
        process.exit()
    }

    if (input === '-v' || input === '--version') {
        version()
        process.exit()
    }

    qrcode.generate(input)
}

if (process.stdin.isTTY) {
    const input = process.argv[2]
    handleInput(input)
} else {
    let input = ''
    process.stdin.on('readable', () => {
        const chunk = process.stdin.read()
        if (chunk !== null) {
            input += chunk
        }
    })
    process.stdin.on('end', () => {
        handleInput(input.trim())
    })
}
