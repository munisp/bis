// Home.tsx — immediate redirect to Dashboard
import { useEffect } from "react";
import { useLocation } from "wouter";

export default function Home() {
  const [, navigate] = useLocation();
  useEffect(() => { navigate("/dashboard", { replace: true }); }, [navigate]);
  return null;
}
