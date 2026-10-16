CREATE DATABASE shopfx;
\connect shopfx
\i /docker-entrypoint-initdb.d/body/shopfx.sql
