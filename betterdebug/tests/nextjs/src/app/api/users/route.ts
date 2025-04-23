// @ts-ignore
import { add, multiply } from '@/lib/util';

class User {
    id: number;
    name: string;
    randomNumber: number;

    constructor(id: number, name: string, randomNumber: number) {
        this.id = id;
        this.name = name;
        this.randomNumber = randomNumber;
    }
}

const users: User[] = [
    new User(1, 'Alice', Math.random()),
    new User(2, 'Bob', Math.random()),
];

export async function GET(request: Request) {
    // await new Promise(resolve => setTimeout(resolve, 100));
    // For example, fetch data from your DB here
    const users = [
        {
            id: 1, name: 'Alice',
            randomNumber: await add(Math.random(), 2)
        },
        {
            id: 2+2,
             name: 'Bob ' + 9,
            randomNumber: await multiply(Math.random(), 2)
        },
    ];

    await new Promise(resolve => {
        setTimeout(resolve, 3000)
    });

    return new Response(JSON.stringify(users), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
}

// https://fastly.picsum.photos/id/64/200/300.jpg?hmac=9MtSCC-H4DQRFtYARRhBDmbZhrJlRQJ2NQLowTY7A-s

export async function POST(request: Request) {
    try {
        // Check if the request has a body
        if (!request.body) {
            return new Response(JSON.stringify({ error: 'No image data provided' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json'  }
            })
        }

        // Get the image data from the request
        const formData = await request.formData()
        const image = formData.get('image')

        // Check if image exists in the request
        if (!image) {
            return new Response(JSON.stringify({ error: 'No image found in request' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            })
        }

        // Return the image with appropriate content type
        if (image instanceof File) {
            const arrayBuffer = await image.arrayBuffer()
            const buffer = Buffer.from(arrayBuffer)

            return new Response(buffer, {
                status: 200,
                headers: {
                    'Content-Type': image.type || 'application/octet-stream',
                    'Content-Disposition': `attachment; filename="${image.name}"`
                }
            })
        }

        // If image is not a File object but some other form data
        return new Response(JSON.stringify({ error: 'Invalid image format' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        })
    } catch (error) {
        console.error('Error processing image:', error)
        return new Response(JSON.stringify({ error: 'Failed to process image' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        })
    }
}
