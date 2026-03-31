import React from "react";
import { motion } from "motion/react";
import { Download, Heart, Loader2, Maximize2 } from "lucide-react";

interface VideoResultCardProps {
  url: string;
  isLiked: boolean;
  onToggleLike: (url: string) => void | Promise<void>;
  onFullscreen: (url: string) => void;
  onDownload: (url: string) => void;
}

export const VideoResultCard: React.FC<VideoResultCardProps> = ({
  url,
  isLiked,
  onToggleLike,
  onFullscreen,
  onDownload,
}) => {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="group relative rounded-[2rem] overflow-hidden bg-zinc-900 border border-white/5 shadow-xl"
    >
      <div className="aspect-video bg-black relative">
        <video
          src={url}
          className="w-full h-full object-contain"
          controls
          playsInline
          loop
          muted
        />
      </div>
      <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={() => onFullscreen(url)}
          className="p-2.5 bg-black/60 backdrop-blur-md rounded-xl text-white hover:bg-black/80"
          title="На весь экран"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onDownload(url)}
          className="p-2.5 bg-black/60 backdrop-blur-md rounded-xl text-white hover:bg-black/80"
          title="Скачать"
        >
          <Download className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => void onToggleLike(url)}
          className={`p-2.5 backdrop-blur-md rounded-xl transition-colors ${
            isLiked ? "bg-red-500 text-white" : "bg-black/60 text-white hover:bg-black/80"
          }`}
          title="В избранное"
        >
          <Heart className={`w-4 h-4 ${isLiked ? "fill-current" : ""}`} />
        </button>
      </div>
    </motion.div>
  );
};

export function VideoLoadingCard() {
  return (
    <div className="rounded-[2rem] border border-white/5 bg-zinc-900/50 aspect-video flex items-center justify-center">
      <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
    </div>
  );
}
