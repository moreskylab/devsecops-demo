

```bash
podman play kube --publish 8080:8080 --publish 8000:8000 --publish 5432:5432 --publish 4317:4317 --publish 4318:4318 --publish 3000:3000 --publish 3100:3100 --publish 3200:3200 --publish 9009:9009 --publish 4040:4040 deployment.yaml

```