/**
 * Extended test file with various edge cases and conditions
 * for testing Babel instrumentation
 */

// Basic if-else logic
function checkValue(value: number): string {
    console.log(`Checking value: ${value}`);

    if (value > 100) {
        return "very high";
    } else if (value > 50) {
        return "high";
    } else if (value > 20) {
        return "medium";
    } else {
        return "low";
    }
}

// Nested conditions with early returns
function processUser(user: { name: string; age: number; isActive: boolean }): string {
    if (user.isActive) {
        if (user.age >= 18) {
            return `${user.name} is an active adult`;
        } else {
            return `${user.name} is an active minor`;
        }
    } else {
        return `${user.name} is inactive`;
    }
}

// Ternary operators and expressions
function getDiscount(isPremium: boolean, purchaseAmount: number): number {
    const baseDiscount = isPremium ? 10 : 5;
    const volumeDiscount = purchaseAmount > 100 ? 5 : 0;
    return baseDiscount + volumeDiscount;
}

// Edge case - null and undefined handling
function processData(data: any): string {
    if (data === null) {
        return "Data is null";
    } else if (data === undefined) {
        return "Data is undefined";
    } else if (data === "") {
        return "Data is empty string";
    } else if (data === 0) {
        return "Data is zero";
    } else if (!data) {
        return "Data is falsy";
    } else {
        return `Data is ${typeof data}: ${data}`;
    }
}

// Complex logical operations
function checkComplexCondition(a: number, b: number, c: string, d: boolean): string {
    if ((a > 10 && b < 20) || (c === "test" && d)) {
        return "Condition 1 met";
    } else if (a === b || (c.startsWith("x") && d === false)) {
        return "Condition 2 met";
    } else if (!(a < b) && c.length > 3) {
        return "Condition 3 met";
    } else {
        return "No conditions met";
    }
}

// Short-circuit logical operators
function testShortCircuit(a: any, b: any, c: any): any {
    // Using && for short-circuit
    const result1 = a && b && c;

    // Using || for short-circuit
    const result2 = a || b || c;

    // Using nullish coalescing
    const result3 = a ?? b ?? c;

    // Optional chaining with possible undefined 
    const obj = { prop: a ? { nested: b } : undefined };
    const result4 = obj?.prop?.nested;

    return { result1, result2, result3, result4 };
}

// Switch statement
function testSwitch(value: number): string {
    switch (value) {
        case 1:
            return "One";
        case 2:
            return "Two";
        case 3:
            return "Three";
        default:
            return "Other";
    }
}

// Try-catch with conditional
function tryCatchTest(input: any): string {
    try {
        if (typeof input === "number") {
            return `Number squared: ${input * input}`;
        } else if (typeof input === "string") {
            return `String reversed: ${input.split("").reverse().join("")}`;
        } else if (Array.isArray(input)) {
            return `Array length: ${input.length}`;
        } else {
            throw new Error("Unsupported input type");
        }
    } catch (error: any) {
        if (error.message.includes("Unsupported")) {
            return "Handled unsupported type error";
        } else {
            return `Unexpected error: ${error.message}`;
        }
    }
}

// Array operations with conditions
function processArray(arr: number[]): number[] {
    if (!arr || arr.length === 0) {
        return [];
    }

    // Filter values using conditions
    const filtered = arr.filter(n => n > 0);

    // Map with conditional expressions
    const mapped = filtered.map(n => n % 2 === 0 ? n * 2 : n * 3);

    // Reduce with conditional
    const sum = mapped.reduce((acc, curr) =>
        acc + (curr > 10 ? curr : 0), 0);

    return [sum, ...mapped];
}

// Async function with conditional logic
async function fetchData(id: number): Promise<string> {
    // Simulate async operation
    await new Promise(resolve => setTimeout(resolve, 0));

    if (id < 0) {
        throw new Error("Invalid ID");
    } else if (id === 0) {
        return "Default data";
    } else if (id > 100) {
        return "Premium data";
    } else {
        return `Data for ID: ${id}`;
    }
}

// Function that uses multiple function results in conditions
function complexOperation(a: number, b: number): number {
    const valueCheck = checkValue(a);
    const discount = getDiscount(valueCheck === "high", b);

    if (valueCheck === "very high" && discount > 5) {
        return a * b;
    } else if (valueCheck === "high" || discount > 10) {
        return a + b;
    } else {
        return a - b;
    }
}

// Immediately-invoked function expression with conditions
const configResult = (() => {
    const config = { debug: true, level: "info" };

    if (config.debug) {
        if (config.level === "verbose") {
            return "Full debugging";
        } else if (config.level === "info") {
            return "Info debugging";
        } else {
            return "Basic debugging";
        }
    } else {
        return "No debugging";
    }
})();

// Execute all functions with various inputs
console.log("-------- EXTENDED CONDITION TESTING --------");

// Basic conditions
console.log("\n-- Basic Condition Tests --");
console.log(`Level 1: ${checkValue(10)}`);
console.log(`Level 2: ${checkValue(30)}`);
console.log(`Level 3: ${checkValue(60)}`);
console.log(`Level 4: ${checkValue(120)}`);

// User processing
console.log("\n-- User Processing Tests --");
console.log(`User 1: ${processUser({ name: "Alice", age: 25, isActive: true })}`);
console.log(`User 2: ${processUser({ name: "Bob", age: 15, isActive: true })}`);
console.log(`User 3: ${processUser({ name: "Charlie", age: 30, isActive: false })}`);

// Discounts
console.log("\n-- Discount Tests --");
console.log(`Discount 1: ${getDiscount(true, 50)}%`);
console.log(`Discount 2: ${getDiscount(false, 150)}%`);

// Null/Undefined handling
console.log("\n-- Null/Undefined Tests --");
console.log(`Null test: ${processData(null)}`);
console.log(`Undefined test: ${processData(undefined)}`);
console.log(`Empty string test: ${processData("")}`);
console.log(`Zero test: ${processData(0)}`);
console.log(`False test: ${processData(false)}`);
console.log(`Valid data test: ${processData("hello")}`);

// Complex conditions
console.log("\n-- Complex Condition Tests --");
console.log(`Test 1: ${checkComplexCondition(15, 10, "test", true)}`);
console.log(`Test 2: ${checkComplexCondition(5, 5, "xyz", false)}`);
console.log(`Test 3: ${checkComplexCondition(30, 20, "hello", false)}`);
console.log(`Test 4: ${checkComplexCondition(5, 10, "hi", false)}`);

// Short circuit
console.log("\n-- Short Circuit Tests --");
console.log("Test 1:", testShortCircuit(true, "hello", 123));
console.log("Test 2:", testShortCircuit(false, "hello", 123));
console.log("Test 3:", testShortCircuit(false, "", null));
console.log("Test 4:", testShortCircuit(null, undefined, "fallback"));

// Switch
console.log("\n-- Switch Tests --");
console.log(`Switch 1: ${testSwitch(1)}`);
console.log(`Switch 2: ${testSwitch(3)}`);
console.log(`Switch 3: ${testSwitch(5)}`);

// Try-catch
console.log("\n-- Try-Catch Tests --");
console.log(`Number input: ${tryCatchTest(4)}`);
console.log(`String input: ${tryCatchTest("hello")}`);
console.log(`Array input: ${tryCatchTest([1, 2, 3])}`);
console.log(`Object input: ${tryCatchTest({ prop: "value" })}`);

// Array processing
console.log("\n-- Array Processing Tests --");
console.log("Test 1:", processArray([1, 2, 3, 4, 5]));
console.log("Test 2:", processArray([-1, 0, 5, 10]));
console.log("Test 3:", processArray([]));

// Async functions (wrapped in IIFE for top-level await)
(async () => {
    console.log("\n-- Async Function Tests --");
    try {
        console.log(`Test 1: ${await fetchData(50)}`);
        console.log(`Test 2: ${await fetchData(0)}`);
        console.log(`Test 3: ${await fetchData(150)}`);

        try {
            console.log(`Test 4: ${await fetchData(-5)}`);
        } catch (error: any) {
            console.log(`Expected error: ${error.message}`);
        }
    } catch (error: any) {
        console.log(`Unexpected async error: ${error.message}`);
    }
})();

// Complex operations
console.log("\n-- Complex Operation Tests --");
console.log(`Test 1: ${complexOperation(120, 50)}`);
console.log(`Test 2: ${complexOperation(60, 75)}`);
console.log(`Test 3: ${complexOperation(30, 20)}`);

// IIFE result
console.log("\n-- IIFE Test --");
console.log(`Config result: ${configResult}`);

console.log("\n-------- EXTENDED CONDITION TESTING COMPLETE --------"); 