export const isObject = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const escapeRegExp = (str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function cloneRecordOfArrays<K extends string, V>(
    record: Record<K, V[]>
): Record<K, V[]> {
    const entries = Object.entries(record) as [K, V[]][]
    const clonedEntries = entries.map(
        ([key, arr]) => [key, [...arr]] as [K, V[]]
    )
    return Object.fromEntries(clonedEntries) as Record<K, V[]>
}

export function isDigit(str: string): boolean {
    return /^\d+$/.test(str)
}

export function isEmpty(input: unknown): boolean {
    if (input === undefined || input === null) return true
    if (Array.isArray(input)) {
        return input.length === 0
    } else if (isObject(input)) {
        return Object.keys(input as Record<string, unknown>).length === 0
    } else if (typeof input === 'string') {
        return input.length === 0
    }

    return false
}
