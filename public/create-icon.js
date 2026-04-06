// Simple script to create a placeholder tray icon
const fs = require('fs');
const path = require('path');

// Base64 encoded 16x16 PNG (simple orange square - thera's brand color)
const iconData = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABOSURBVDiNY/z//z8DJYCRUgNgYBgF+MDu3bv/M1AJmDZtGvUMuHjx4n8GKgHLly+nngFoYBTgY8C1a9f+M1AJWLhwIfUMgIFRAFYBANJ4Cul0TKhpAAAAAElFTkSuQmCC';

const buffer = Buffer.from(iconData, 'base64');
fs.writeFileSync(path.join(__dirname, 'icon.png'), buffer);

console.log('Tray icon created!');
