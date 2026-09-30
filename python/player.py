#!/usr/bin/env python3
"""Pulse desktop player — pygame + PyAV.

Play local video/audio with a small VLC-like control surface.
Seeking is keyframe-approximate. Audio is extracted with ffmpeg when available.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import av
import pygame

MEDIA_EXT = {
    ".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".wmv",
    ".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac",
}

HELP = """
Space play/pause   S stop        O open path
Left/Right -/+10s  Up/Down vol   M mute
N / P next/prev    [ ] speed     F fullscreen
Q quit
""".strip()


@dataclass
class Clip:
    path: Path


def collect(paths: list[str]) -> list[Clip]:
    out: list[Clip] = []
    for raw in paths:
        p = Path(raw).expanduser().resolve()
        if p.is_dir():
            for child in sorted(p.iterdir()):
                if child.suffix.lower() in MEDIA_EXT:
                    out.append(Clip(child))
        elif p.is_file():
            out.append(Clip(p))
    return out


def extract_audio(src: Path, dest: Path) -> bool:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return False
    cmd = [
        ffmpeg, "-y", "-i", str(src),
        "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2",
        str(dest),
    ]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return dest.exists() and dest.stat().st_size > 0
    except (OSError, subprocess.CalledProcessError):
        return False


class Player:
    def __init__(self, playlist: list[Clip]) -> None:
        pygame.init()
        pygame.mixer.init(frequency=44100, size=-16, channels=2)
        self.screen = pygame.display.set_mode((960, 540), pygame.RESIZABLE)
        pygame.display.set_caption("Pulse")
        self.clock = pygame.time.Clock()
        self.font = pygame.font.SysFont("consolas", 16)
        self.playlist = playlist
        self.index = 0 if playlist else -1
        self.container: av.container.InputContainer | None = None
        self.vstream = None
        self.paused = False
        self.stopped = True
        self.volume = 0.9
        self.muted = False
        self.rate = 1.0
        self.frame_image: pygame.Surface | None = None
        self.audio_path: Path | None = None
        self.tmp: tempfile.TemporaryDirectory[str] | None = None
        self.duration = 0.0
        self.started_at = 0
        self.offset = 0.0
        self.running = True

    def close_clip(self) -> None:
        pygame.mixer.music.stop()
        if self.container:
            self.container.close()
            self.container = None
        self.vstream = None
        if self.tmp:
            self.tmp.cleanup()
            self.tmp = None
        self.audio_path = None
        self.frame_image = None

    def open_clip(self, i: int) -> None:
        if not self.playlist:
            return
        self.close_clip()
        self.index = i % len(self.playlist)
        clip = self.playlist[self.index]
        pygame.display.set_caption(f"Pulse — {clip.path.name}")
        self.container = av.open(str(clip.path))
        self.vstream = next((s for s in self.container.streams.video), None)
        if self.vstream:
            self.vstream.thread_type = "AUTO"
        self.duration = float(self.container.duration or 0) / av.time_base
        self.tmp = tempfile.TemporaryDirectory(prefix="pulse-")
        wav = Path(self.tmp.name) / "audio.wav"
        if extract_audio(clip.path, wav):
            self.audio_path = wav
            pygame.mixer.music.load(str(wav))
            pygame.mixer.music.set_volume(0 if self.muted else self.volume)
        self.offset = 0.0
        self.stopped = False
        self.paused = False
        self.started_at = pygame.time.get_ticks()
        if self.audio_path:
            pygame.mixer.music.play()
        self.decode_until(0.04)

    def media_time(self) -> float:
        if self.stopped:
            return 0.0
        if self.paused:
            return self.offset
        return self.offset + (pygame.time.get_ticks() - self.started_at) / 1000.0 * self.rate

    def decode_until(self, t: float) -> None:
        if not self.container or not self.vstream:
            return
        target = max(0.0, t)
        try:
            self.container.seek(int(target * av.time_base), backward=True, any_frame=False)
        except av.AVError:
            return
        for frame in self.container.decode(self.vstream):
            ts = float(frame.time or 0)
            if ts < target - 0.25:
                continue
            img = frame.to_image().convert("RGB")
            raw = img.tobytes()
            surf = pygame.image.fromstring(raw, img.size, "RGB")
            self.frame_image = surf
            break

    def toggle(self) -> None:
        if self.index < 0 and self.playlist:
            self.open_clip(0)
            return
        if self.stopped:
            if self.playlist:
                self.open_clip(self.index if self.index >= 0 else 0)
            return
        self.paused = not self.paused
        if self.paused:
            self.offset = self.media_time()
            pygame.mixer.music.pause()
        else:
            self.started_at = pygame.time.get_ticks()
            pygame.mixer.music.unpause()

    def stop(self) -> None:
        self.paused = False
        self.stopped = True
        self.offset = 0.0
        pygame.mixer.music.stop()

    def seek(self, delta: float) -> None:
        if self.index < 0:
            return
        t = max(0.0, self.media_time() + delta)
        if self.duration:
            t = min(t, max(0.0, self.duration - 0.1))
        self.offset = t
        self.started_at = pygame.time.get_ticks()
        if self.audio_path:
            try:
                pygame.mixer.music.play(start=t)
                pygame.mixer.music.set_volume(0 if self.muted else self.volume)
                if self.paused:
                    pygame.mixer.music.pause()
            except pygame.error:
                pass
        self.decode_until(t)

    def apply_volume(self) -> None:
        pygame.mixer.music.set_volume(0 if self.muted else self.volume)

    def draw(self) -> None:
        self.screen.fill((0, 0, 0))
        rect = self.screen.get_rect()
        if self.frame_image:
            iw, ih = self.frame_image.get_size()
            scale = min(rect.width / iw, (rect.height - 48) / ih)
            size = (max(1, int(iw * scale)), max(1, int(ih * scale)))
            fitted = pygame.transform.smoothscale(self.frame_image, size)
            fr = fitted.get_rect(center=(rect.centerx, (rect.height - 48) // 2))
            self.screen.blit(fitted, fr)
        elif self.playlist:
            name = self.playlist[self.index].path.name if self.index >= 0 else "Pulse"
            text = self.font.render(name, True, (255, 136, 0))
            self.screen.blit(text, text.get_rect(center=(rect.centerx, rect.centery - 24)))
        else:
            text = self.font.render("Drop files onto the window or pass paths on the CLI", True, (180, 180, 180))
            self.screen.blit(text, text.get_rect(center=rect.center))

        bar = pygame.Rect(0, rect.height - 48, rect.width, 48)
        pygame.draw.rect(self.screen, (28, 28, 28), bar)
        t = self.media_time()
        if self.duration > 0:
            pygame.draw.rect(self.screen, (80, 80, 80), (12, rect.height - 36, rect.width - 24, 6))
            pygame.draw.rect(
                self.screen,
                (255, 136, 0),
                (12, rect.height - 36, int((rect.width - 24) * min(1.0, t / self.duration)), 6),
            )
        label = f"{self._fmt(t)} / {self._fmt(self.duration)}   {self.rate:.2f}x   vol {0 if self.muted else int(self.volume * 100)}%"
        if self.playlist and self.index >= 0:
            label += f"   {self.index + 1}/{len(self.playlist)} {self.playlist[self.index].path.name}"
        self.screen.blit(self.font.render(label, True, (230, 230, 230)), (12, rect.height - 24))
        pygame.display.flip()

    @staticmethod
    def _fmt(t: float) -> str:
        t = max(0, int(t))
        return f"{t // 60:02d}:{t % 60:02d}"

    def handle(self, event: pygame.event.Event) -> None:
        if event.type == pygame.QUIT:
            self.running = False
        elif event.type == pygame.DROPFILE:
            extra = collect([event.file])
            self.playlist.extend(extra)
            if extra and self.index < 0:
                self.open_clip(0)
        elif event.type == pygame.KEYDOWN:
            k = event.key
            if k in (pygame.K_q, pygame.K_ESCAPE):
                self.running = False
            elif k == pygame.K_SPACE:
                self.toggle()
            elif k == pygame.K_s:
                self.stop()
            elif k == pygame.K_RIGHT:
                self.seek(10)
            elif k == pygame.K_LEFT:
                self.seek(-10)
            elif k == pygame.K_UP:
                self.volume = min(1.0, self.volume + 0.05)
                self.apply_volume()
            elif k == pygame.K_DOWN:
                self.volume = max(0.0, self.volume - 0.05)
                self.apply_volume()
            elif k == pygame.K_m:
                self.muted = not self.muted
                self.apply_volume()
            elif k == pygame.K_n and self.playlist:
                self.open_clip(self.index + 1)
            elif k == pygame.K_p and self.playlist:
                self.open_clip(self.index - 1)
            elif k == pygame.K_LEFTBRACKET:
                self.rate = max(0.25, self.rate - 0.25)
            elif k == pygame.K_RIGHTBRACKET:
                self.rate = min(2.0, self.rate + 0.25)
            elif k == pygame.K_f:
                pygame.display.toggle_fullscreen()
            elif k == pygame.K_o:
                print("Pass files or a folder as arguments: python player.py ~/Videos/clip.mp4")
            elif k == pygame.K_h:
                print(HELP)

    def pump_video(self) -> None:
        if self.paused or self.stopped or not self.container or not self.vstream:
            return
        t = self.media_time()
        if self.duration and t >= self.duration - 0.05:
            if self.index + 1 < len(self.playlist):
                self.open_clip(self.index + 1)
            else:
                self.stop()
            return
        try:
            for frame in self.container.decode(self.vstream):
                ts = float(frame.time or 0)
                if ts + 0.04 < t:
                    continue
                img = frame.to_image().convert("RGB")
                self.frame_image = pygame.image.fromstring(img.tobytes(), img.size, "RGB")
                break
        except (av.AVError, StopIteration, OSError):
            pass

    def run(self) -> None:
        if self.playlist:
            self.open_clip(0)
        print(HELP)
        while self.running:
            for event in pygame.event.get():
                self.handle(event)
            self.pump_video()
            self.draw()
            self.clock.tick(30)
        self.close_clip()
        pygame.quit()


def main() -> int:
    paths = sys.argv[1:]
    player = Player(collect(paths))
    player.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
