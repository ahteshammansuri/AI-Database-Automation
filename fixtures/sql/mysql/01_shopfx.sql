CREATE DATABASE IF NOT EXISTS shopfx CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE shopfx;
SOURCE /docker-entrypoint-initdb.d/body/shopfx.sql;
