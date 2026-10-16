CREATE DATABASE IF NOT EXISTS shopfx_w CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE shopfx_w;
SOURCE /docker-entrypoint-initdb.d/body/shopfx_w.sql;
