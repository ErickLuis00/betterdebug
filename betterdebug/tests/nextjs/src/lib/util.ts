





export function multiply(a: number, b: number) {
    console.log('multiply', a, b);
    if (a === 0 || b === 0) {
        return 0;
    }
    return a * b;
}




export async function add(a: number, b: number) {
    // await new Promise(resolve => setTimeout(resolve, 5000));
    const result = a + b;
    return result + a;
}



