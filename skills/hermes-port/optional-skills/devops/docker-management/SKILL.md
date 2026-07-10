---
name: docker-management
description: "Manage Docker containers, images, volumes, networks, and Compose stacks using standard Docker CLI commands."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos]
---

# Docker Management

Manage Docker containers, images, volumes, networks, and Compose stacks using standard Docker CLI commands. No additional dependencies beyond Docker itself.

## When to Use

- Run, stop, restart, remove, or inspect containers
- Build, pull, push, tag, or clean up Docker images
- Work with Docker Compose (multi-service stacks)
- Manage volumes or networks
- Debug a crashing container or analyze logs
- Check Docker disk usage or free up space
- Review or optimize a Dockerfile

## Prerequisites

- Docker Engine installed and running
- User added to the `docker` group (or use `sudo`)
- Docker Compose v2 (included with modern Docker installations)

Quick check:

\`\`\`bash
docker --version && docker compose version
\`\`\`

## Quick Reference

| Task | Command |
|------|---------|
| Run container (background) | `docker run -d --name NAME IMAGE` |
| Stop + remove | `docker stop NAME && docker rm NAME` |
| View logs (follow) | `docker logs --tail 50 -f NAME` |
| Shell into container | `docker exec -it NAME /bin/sh` |
| List all containers | `docker ps -a` |
| Build image | `docker build -t TAG .` |
| Compose up | `docker compose up -d` |
| Compose down | `docker compose down` |
| Disk usage | `docker system df` |
| Cleanup dangling | `docker image prune && docker container prune` |

## Common Patterns

### Run a new container

\`\`\`bash
# Detached service with port mapping
docker run -d --name web -p 8080:80 nginx

# With environment variables
docker run -d -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=mydb --name db postgres:16

# With persistent data (named volume)
docker run -d -v pgdata:/var/lib/postgresql/data --name db postgres:16
\`\`\`

### Docker Compose

\`\`\`bash
docker compose up -d                   # start all services detached
docker compose up -d --build           # rebuild images before starting
docker compose down                    # stop and remove containers
docker compose down -v                 # also remove volumes (DESTROYS DATA)
docker compose ps                      # list services
docker compose logs -f api             # follow logs for specific service
\`\`\`

### Disk cleanup

\`\`\`bash
docker system df                       # summary
docker image prune                     # remove dangling (untagged) images
docker container prune                 # remove ALL stopped containers
\`\`\`

## Pitfalls

| Problem | Cause | Fix |
|---------|-------|-----|
| Container exits immediately | Main process finished or crashed | Check `docker logs NAME` |
| "port is already allocated" | Another process using that port | `docker ps` or `lsof -i :PORT` to find it |
| "no space left on device" | Docker disk full | `docker system df` then targeted prune |
| Can't connect to container | App binds to 127.0.0.1 inside container | App must bind to `0.0.0.0` |

## Dockerfile Optimization Tips

1. **Multi-stage builds** — separate build environment from runtime
2. **Layer ordering** — put dependencies before source code
3. **Combine RUN commands** — fewer layers, smaller image
4. **Use .dockerignore** — exclude `node_modules`, `.git`, `__pycache__`
5. **Pin base image versions** — `node:20-alpine` not `node:latest`