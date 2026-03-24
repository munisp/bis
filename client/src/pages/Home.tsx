// Home.tsx — redirect to dashboard, with auth awareness
import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";

export default function Home() {
  const [, navigate] = useLocation();
  const { loading } = useAuth();

  useEffect(() => {
    if (!loading) {
      navigate("/dashboard", { replace: true });
    }
  }, [loading, navigate]);

  return null;
}
