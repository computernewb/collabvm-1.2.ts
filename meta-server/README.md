# @cvmts/meta-server

API server that hosts common services that can be utilized by multiple CollabVM server instances.

## IAOS

So far, its only function is to support the Install Any OS feature by serving a list of ISO/floppy files along with descriptions and image URLs

For now, this just reads a static list from a .toml file and serves it. In the future, it may have support for database functionality, authentication, API-based changes, and temporary user uploads.

## Future additions

Eventually, I would like to move GeoIP and banning into the meta server
