# ytm-desktop controller

![](jp.hayate-kojima.ytm-desktop-controller.sdPlugin/imgs/cover.png)

This streamdeck plugin allows you to control YouTube Music with [pear-desktop](https://github.com/pear-devs/pear-desktop) (previous name: th-ch/ytm-desktop). 

[![Marketplace](https://img.shields.io/badge/Preparing_at-Elgato_Marketplace-3E72BC)]()
[![Buy Me a Coffee](https://img.shields.io/badge/-buy_me_a%C2%A0coffee-gray?logo=buy-me-a-coffee)](https://www.buymeacoffee.com/yate)
[![Stars](https://img.shields.io/github/stars/tuat-yate/ytm-desktop-controller)](https://github.com/tuat-yate/ytm-desktop-controller/stargazers)
[![Watchers](https://img.shields.io/github/watchers/tuat-yate/ytm-desktop-controller)](https://github.com/tuat-yate/ytm-desktop-controller/watchers)

## Setup
1. Install [pear-desktop](https://github.com/pear-devs/pear-desktop)  
    Please refer [pear-desktop installation guide](https://github.com/pear-devs/pear-desktop?tab=readme-ov-file#download).
2. Set API Plugin on pear-desktop
    Please click `Plugins -> API Server [beta]`, then, set `Plugins -> API Server [beta] -> Authorization strategy -> No authorization`.  
    Note: Default port number of API is set to `26538` (you can check it in `Plugins -> API Server [beta] -> Port`). 

3. Install Streamdeck Plugin [here]()

## Features

### Base Arguments
- `Port`: port number of the API. Default is `26538`.
- `Show Now-playing Artwork`: Show artwork if play.

### Add Playlist to Queue
Add a YouTube Music playlist to the queue. 
> [!NOTE]
> The playlist that you want to play must be shared as `Public` or `Unlisted`. 

- `Playlist Id`: The ID of the playlist. If the shared link is `https://music.youtube.com/playlist?list=PL4fGSI1pDJn5r5mDEEb63gTrvZVrbBOck`, `Playlist Id` is `PL4fGSI1pDJn5r5mDEEb63gTrvZVrbBOck`.
- `Force Play`: Skip the current queue and play.
- `Shuffle`: Shuffle the playlist before adding to the queue.

### Add Track to Queue
Add a YouTube Music track to the queue. If the music link is `https://music.youtube.com/watch?v=wggigwtz4dQ&...`, `Playlist Id` is `wggigwtz4dQ`.

- `videoId`: The ID of the video.
- `forcePlay`: kip the current queue and play.

### Artwork
Displays the album art of the currently playing song.

### Go Forward
Fast-forward the currently playing song. 

- `time`: The number of seconds to fast-forward.

### Go Back
Rewind the currently playing song.

- `time`: The number of seconds to rewind.

### Toggle Play
Toggle play/pause. 

### Next
Skip to the next track.

### Previous
Skip to the previous track.

### Like
Like the currently playing song. 

### Dislike
Dislike the currently playing song. 




