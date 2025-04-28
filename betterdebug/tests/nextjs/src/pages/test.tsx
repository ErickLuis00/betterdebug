import React, { useEffect, useState } from 'react';

// This component will be rendered by Next.js for the /test route

function TestPage() {
    const [count, setCount] = useState(0);
    const [users, setUsers] = useState<{ id: number; name: string; randomNumber: number }[]>([]);
    const [loading, isLoading] = useState(false);

    console.log("OPA FROM")

    // This useEffect hook runs only on the client-side after the component mounts
    useEffect(() => {
        console.log('[Test Page - Browser] Component did mount.'); // Standard log
        const initialMessage = 'Effect hook running on client.'; // Should be instrumented by log-lines-plugin
        document.title = 'Test Page Loaded'; // Should be instrumented
    }, []); // Empty dependency array ensures it runs only once on mount

    // Fetch users from the API route
    useEffect(() => {
        async function fetchUsers() {
            isLoading(true);
            try {
                const response = await fetch('/api/users');
                const data = await response.json();
                setUsers(data);
            } catch (error) {
                console.error('[Test Page - Browser] Error fetching users:', error);
            } finally {
                isLoading(false);
            }
        }


        fetchUsers();
    }, []);

    // This function runs only on the client-side when the button is clicked
    const handleClick = () => {
        console.log('[Test Page - Browser] Button clicked!'); // Standard log
        const newCount = count + 1; // Should be instrumented
        setCount(newCount); // Should be instrumented
        alert(`Button clicked! Count is now ${newCount}`); // Should be instrumented (alert itself might not, but the line is)
    };

    console.log('[Test Page] Rendering component...'); // Runs on server AND client (during hydration)

    return (
        <div style={{ padding: '20px' }}>
            <h1>Test Page (Pages Router)</h1>
            <p>This page is designed to test client-side execution logging.</p>
            <p>Check your browser console and the WebSocket server logs.</p>
            <hr />
            <p>Current Count: {count}</p>
            <button onClick={handleClick}>
                Click Me (Client-Side Action)
            </button>
            <hr />
            <div>
                <h2>Users from API:</h2>
                {loading ? (
                    <p>Loading users...</p>
                ) : (
                    <ul>
                        {users.map(user => (
                            <li key={user.id}>
                                {user.name} - Random Number: {user.randomNumber}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <hr />
            <p>The useEffect hook ran on component mount (client-side).</p>
        </div>
    );
}

export default TestPage; 