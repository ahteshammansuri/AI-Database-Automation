CREATE DATABASE shopfx_w;
\connect shopfx_w
\i /docker-entrypoint-initdb.d/body/shopfx_w.sql
