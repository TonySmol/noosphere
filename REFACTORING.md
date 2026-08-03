# NOO.mium - Refactored Structure

«Не ищи информацию. Позволь ей найти себя»

## Project Structure

This refactoring separates the monolithic `index.html` into modular ES6 modules:

```
/workspace
├── index.html          # Main HTML with CSS link and module imports
├── css/
│   └── styles.css      # All application styles
├── js/
│   ├── core/           # Core infrastructure
│   │   ├── di.js       # Dependency Injection container
│   │   ├── config.js   # Configuration management
│   │   ├── eventbus.js # Event pub/sub system
│   │   ├── logger.js   # Logging utility
│   │   ├── utils.js    # Utility functions
│   │   ├── i18n.js     # Internationalization
│   │   └── store.js    # State management
│   ├── data/           # Data layer
│   │   ├── vec.js      # Vector operations
│   │   └── db.js       # Database operations
│   ├── ai/             # AI/ML components
│   │   ├── embedder.js # Text embedding
│   │   └── ranker.js   # Semantic ranking
│   ├── net/            # Network layer
│   │   ├── protocol.js # Protocol definitions
│   │   ├── nostr.js    # Nostr protocol implementation
│   │   └── netservice.js # Network service
│   ├── domain/         # Business logic
│   │   ├── notes.js    # Note management
│   │   ├── context.js  # Context handling
│   │   ├── feed.js     # Feed management
│   │   ├── provenance.js # Provenance tracking
│   │   ├── influence.js # Influence scoring
│   │   └── noteactions.js # Note actions
│   ├── ui/             # UI components
│   │   ├── onboarding.js
│   │   ├── modal.js
│   │   ├── toast.js
│   │   ├── progress.js
│   │   ├── headerstatus.js
│   │   ├── composer.js
│   │   ├── feedview.js
│   │   ├── baseview.js
│   │   ├── noteview.js
│   │   └── menuview.js
│   ├── input/          # Input handling
│   │   └── hotkeys.js
│   └── boot.js         # Application bootstrap
└── README.md
```

## Key Changes

1. **CSS Extraction**: All styles moved to `css/styles.css`
2. **Module System**: JavaScript split into ES6 modules organized by concern
3. **Dependency Injection**: Centralized DI container in `core/di.js`
4. **English Documentation**: Comments translated to English for broader accessibility
5. **Clean Separation**: Each module has a single responsibility

## Usage

Open `index.html` in a modern browser that supports ES6 modules.

## Architecture Layers

- **Core**: Infrastructure (DI, Config, EventBus, Logger, Utils, I18n, Store)
- **Data**: Persistence and vector operations
- **AI**: Embedding and semantic ranking
- **Net**: Nostr protocol and network communication
- **Domain**: Business logic for notes, feeds, context
- **UI**: View components and user interactions
- **Input**: Keyboard shortcuts and user input
