# Sounds

These eight clips were generated for this game with ElevenLabs sound
generation from the text prompts in [provenance.json](provenance.json), which
also records each file's length and checksum. They are not recordings of
Boston, of any vehicle or of any person, and no voices or music were used.
The game plays them from these files; the browser never calls the service and
no key ships with the game.

| File | Length | Use |
|---|---:|---|
| engine-idle.mp3 | 4 s loop | Engine at idle |
| engine-drive.mp3 | 4 s loop | Engine at mid revs; crossfaded with the idle by the simulated gearbox |
| tire-road.mp3 | 4 s loop | Rolling tyre noise, rising with speed |
| tire-skid.mp3 | 3 s loop | Tyre scrub on tight turns and handbrake slides |
| city-ambience.mp3 | 16 s loop | Neighbourhood bed, quieter at speed |
| impact-light.mp3 | 1 s | Kerb and parked-car bumps |
| impact-heavy.mp3 | 1.6 s | Hard collisions |
| horn.mp3 | 0.9 s | The N key |

At load the runtime (`src/audio/game-audio.ts`) crossfades each loop's last
60 ms into its start to hide the codec seam and scales every clip to a common
loudness with peak headroom.
