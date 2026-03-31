import React, { useEffect } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";

interface VideoLightboxProps {
  videoUrl: string;
  onClose: () => void;
}

export function VideoLightbox({ videoUrl, onClose }: VideoLightboxProps) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      key={videoUrl}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] bg-zinc-950 flex flex-col items-center justify-center p-4 pt-16 pb-28"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-6 right-6 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white"
        aria-label="Закрыть"
      >
        <X className="w-6 h-6" />
      </button>
      <video
        src={videoUrl}
        className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl"
        controls
        playsInline
        autoPlay
        loop
      />
    </motion.div>
  );
}
