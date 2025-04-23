export function add(a: number, b: number): number {
    const result = a + b;
    return result;
}

export function multiply(a: number, b: number): number {
    if (a === 0 || b === 0) {
        return 0;
    }
    return a * b;
} 