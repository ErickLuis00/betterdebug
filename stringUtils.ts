export function capitalize(str: string): string {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

export function reverse(str: string): string {
    return str.split('').reverse().join('');
} 