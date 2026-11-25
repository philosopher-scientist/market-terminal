# Source and data boundaries

Original software and documentation in this repository are released under
[MIT No Attribution (MIT-0)](LICENSE). The portable HTML includes the license text
in its source. No chart library, external font or executable remote script is
bundled into the application.

The interface draws inspiration from the former Cryptowatch terminal.
References to other products and educational sources do not imply affiliation.
Names and trademarks belong to their respective owners.

Market data adapters cover Kraken, Coinbase Exchange, Bitstamp, Binance,
Binance.US, Yahoo Finance and optional Twelve Data. Yahoo requests use configured
cors.dev, AllOrigins or cors.lol relay paths. Their services, data and terms
are separate from the project's software license. This repository does not grant
rights to redistribute third-party data. Provider responses and historical price
snapshots are not included in the public source package.

Technical access does not grant public-display or redistribution permission.
The live demo remains unhosted. See [data-source coverage and terms](docs/DATA-SOURCES.md)
before using the application as a public service.

The optional `research/plot-amzn-study.py` helper imports Matplotlib, which is not
bundled or needed to run the terminal. Its own license applies to that dependency.
