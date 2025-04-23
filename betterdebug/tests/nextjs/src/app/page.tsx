"use client";
import { add, multiply } from "@/lib/util";
import Image from "next/image";
import { useEffect } from "react";



export default async function Home() {
  // const users = await fetch('http://localhost:3000/api/users');
  // const usersData = await users.json();

  const usersData = [
    { id: 1, name: 'John Doe', randomNumber: 42 },
    { id: 2, name: 'Jane Smith', randomNumber: 17 },
    { id: 3, name: 'Alice Johnson', randomNumber: 99 },
    { id: 4, name: 'Bob Brown', randomNumber: 33 },
    { id: 5, name: 'Charlie Davis', randomNumber: 66 },
  ];

  useEffect(() => {
    let ovo = 1;
    ovo = ovo + 1;
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      sum = sum + i;
    }
    console.log(sum);

  }, []);


  useEffect(() => {
    let ovo = 1;
    ovo = ovo + 1;
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      sum = sum + i;
    }
    console.log(sum);

  }, []);

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <header className="w-full flex justify-between items-center">
        <h1 className="text-2xl font-bold">User Dashboard</h1>
      </header>
      <main className="w-full max-w-4xl">
        <UserList users={usersData} />
      </main>
      <footer className="text-sm text-gray-500">
        © {new Date().getFullYear()} Next.js Demo
      </footer>
    </div>
  );
}

interface UserListProps {
  users: { id: number; name: string; randomNumber: number }[];
}

function UserList({ users }: UserListProps) {
  return (
    <ul>
      {users.map((user) => (
        <li key={user.id}>{user.name} - {user.randomNumber}</li>
      ))}
    </ul>
  );
}


