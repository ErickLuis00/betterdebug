import express, { Request, Response, NextFunction } from 'express';
import { add, multiply } from './mathUtils';
import { capitalize } from './stringUtils';

// Create a new express application
const app = express();
const PORT = 3000;

// Middleware to log requests
app.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
    next();
});

// Middleware for JSON parsing
app.use(express.json());

// Routes
app.get('/', (req: Request, res: Response) => {
    const welcomeMessage = capitalize('welcome to the api');
    res.json({ message: welcomeMessage });
});

// Math operations route
app.get('/calculate', (req: Request, res: Response) => {
    const a = parseInt(req.query.a as string) || 0; const b = parseInt(req.query.b as string) || 0; const operation = req.query.operation as string; let result: number;

    if (operation === 'multiply') {
        result = multiply(a, b);
    } else {
        // Default to addition
        result = add(a, b);
    }

    res.json({
        operation: operation || 'add',
        a,
        b,
        result
    });
});

// User route with validation middleware
const validateUserData = (req: Request, res: Response, next: NextFunction) => {
    const { name, age } = req.body;

    if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'Valid name is required' });
    }

    if (!age || isNaN(Number(age)) || Number(age) <= 0) {
        return res.status(400).json({ error: 'Valid age is required' });
    }

    next();
};

app.post('/users', validateUserData, (req: Request, res: Response) => {
    const { name, age } = req.body;
    // const formattedName = capitalize(name);

    // Process user data
    const userData = {
        id: Math.floor(Math.random() * 1000),
        name: name,
        age: Number(age),
        createdAt: new Date()
    };

    res.status(201).json(userData);
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error(`Error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
});

// Demonstrate functions before starting the server
// This way the process won't exit after this code runs
// processValues(5, 10, 'test');

// Start the server last
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

// // Keep the original function to demonstrate both examples
// function processValues(a: number, b: number, name: string): void {
//     console.log(`Processing for ${name}...`);

//     const sum = add(a, b);
//     console.log(`Sum: ${sum}`);

//     const product = multiply(a, b);
//     console.log(`Product: ${product}`);

//     const formattedName = capitalize(name);
//     console.log(`Formatted name: ${formattedName}`);
// } 