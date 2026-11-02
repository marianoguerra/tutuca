---
name: logo
description: The Logo commands this turtle knows and how it draws.
---

The turtle starts at (0, 0) facing up, with its pen down.

| command | does |
|---|---|
| `forward n`, `fd n` | moves n steps, drawing when the pen is down |
| `back n`, `bk n` | moves back |
| `right d`, `rt d` | turns d degrees clockwise |
| `left d`, `lt d` | turns counterclockwise |
| `penup`, `pu` / `pendown`, `pd` | stops / starts drawing |
| `color name` | a CSS color for the next lines |
| `repeat n [ … ]` | runs the commands n times |

A regular polygon with k sides: `repeat k [ fd 50 rt 360/k ]` (write the number: `rt 72`).
