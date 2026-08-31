# Maze Monster Battleground — VS Code Version

This is a dependency-free browser game made with plain HTML, CSS, and JavaScript.
It plays with a keyboard on desktop and with touch on phones and tablets.

## Included

- Procedurally generated maze
- Keyboard, mouse, and touch controls
- Sprint/stamina system
- Gun with 12-round magazine
- **50 damage per shot**
- Monster with **250 HP**
- Monster claw attack
- Monster pathfinding through the maze
- Monster respawns after 4 seconds
- Monster always respawns at the **same lair**
- Golden key + locked exit objective
- MP3 soundtrack from `sound/`, with a generated Web Audio score as fallback
- Music swells as the monster gets closer
- Board resizes to fit any screen, in portrait or landscape
- On-screen d-pad, fire/sprint/reload buttons, and fullscreen
- HUD sits in its own strip above the maze, so it never covers the player
- A blue ring marks your character at the start of each run

## Keyboard controls

| Key | Action |
| --- | --- |
| W / ↑ | Move up |
| A / ← | Move left |
| S / ↓ | Move down |
| D / → | Move right |
| Shift | Sprint |
| J | Shoot |
| E | Reload |
| R | Restart |

Keys work as soon as the page loads — you do not have to click the maze first,
and they keep working after you click a button.

**Which one is me?** You are the small blue-jacketed figure that starts in the
top-left corner, circled by a pulsing blue ring until you get moving. The
monster is the red figure that starts at the `LAIR` in the top-right.

## Touch controls

| Gesture | Action |
| --- | --- |
| Drag anywhere on the maze | Virtual joystick — move (analog speed) |
| Quick tap on the maze | Shoot |
| D-pad buttons | Move |
| FIRE / SPRINT / RELOAD | Shoot, sprint, reload |
| Fullscreen | Full-screen play (where the browser supports it) |

The joystick appears wherever your thumb lands, so there is no fixed spot to
hunt for. Sliding a finger slightly off a button will not drop the input.

## Mobile notes

- The maze is sized to fit both the screen width and height, so the whole board
  is visible without page scrolling.
- Landscape puts the d-pad on the left and the action buttons on the right, with
  the maze between them.
- Rotating the device re-fits the board.
- Safe-area insets are respected, so nothing hides under a notch or home bar.
- Audio starts on your first tap (browsers require a gesture) and pauses when the
  tab or app goes to the background.

## Music

The soundtrack is the file referenced by the `<audio id="musicTrack">` element in
`index.html`:

```html
<audio id="musicTrack" loop preload="auto"
       src="sound/For%20the%20creature%20hunt%20_%20danger%20version_.mp3"></audio>
```

To swap tracks, drop a file into `sound/` and point that `src` at it
(URL-encode spaces as `%20`). If the file is missing or cannot be played, the
game falls back to the generated Web Audio horror score, so there is always
music. The **Music** button toggles the soundtrack and the sound effects.

## Run in VS Code

### Easiest: Live Server

1. Open this folder in VS Code.
2. Install the **Live Server** extension if you do not already have it.
3. Right-click `index.html`.
4. Choose **Open with Live Server**.
5. Click or tap inside the game once so the browser is allowed to start audio.

### No extension needed

From the VS Code terminal:

```bash
npm run serve
```

or

```bash
python3 -m http.server 5500
```

Then open:

```text
http://localhost:5500
```

### Playing on your phone

Serve the folder as above, then open `http://<your-computer-ip>:5500` on a phone
on the same Wi-Fi network. Find the IP with `ipconfig getifaddr en0` on macOS.

## Important files

- `index.html` — page/UI
- `style.css` — responsive styling
- `game.js` — game logic, monster AI, combat, maze generation, and audio
- `sound/` — soundtrack files

## Easy tuning

At the top of `game.js` you can change:

```js
const MAG_SIZE = 12;
const SHOT_DAMAGE = 50;
const MONSTER_HP = 250;
const MONSTER_RESPAWN_SECONDS = 4;
```

Player speed:

```js
speed: 5,
```

Monster speed:

```js
speed: 2.7,
```

Fixed monster spawn:

```js
const MONSTER_SPAWN = { x: COLS - 1.5, y: 1.5 };
```

Soundtrack loudness (calm vs. monster nearby):

```js
const TRACK_VOLUME_CALM = 0.42;
const TRACK_VOLUME_DANGER = 0.85;
```

Touch joystick feel:

```js
const STICK_RADIUS = 52;
const STICK_DEADZONE = 7;
```
