# EagleDocs sandbox: one container per user, started on demand by the backend.
# Chromium (Playwright's headless shell only) + Python with document/data libraries + Node + the runner.
# Debian slim rather than Alpine: Playwright's Chromium and the Python wheels need glibc.
FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip tini ca-certificates fonts-dejavu-core fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

# What the agent's documents and data work needs (PDF, Word, PowerPoint, Excel, charts).
RUN pip3 install --break-system-packages --no-compile \
      pymupdf==1.26.4 pypdf==6.1.1 python-docx==1.2.0 python-pptx==1.0.2 openpyxl==3.1.5 \
      pandas==2.3.3 numpy==2.3.3 matplotlib==3.10.6 reportlab==4.4.4 requests==2.32.5 \
 && find /usr/local/lib/python3* /usr/lib/python3 -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null; \
    find /usr/local/lib/python3* -name 'tests' -path '*/site-packages/*' -prune -exec rm -rf {} + 2>/dev/null; true

WORKDIR /opt/runner
COPY runner/package.json runner/package-lock.json ./
# Only Chromium's headless shell (no Firefox/WebKit, no headed Chromium) and the system libraries it needs.
RUN npm ci --omit=dev --ignore-scripts \
 && npx playwright-core install --with-deps --only-shell chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm /tmp/*
COPY runner/*.mjs ./

# Unprivileged user; the workspace is bind-mounted at /workspace by the backend.
RUN mkdir -p /workspace && chown 1000:1000 /workspace
USER 1000:1000
WORKDIR /workspace

LABEL eagledocs.sandbox.image="1"
EXPOSE 7070
ENTRYPOINT ["/usr/bin/tini", "--", "node", "/opt/runner/runner.mjs"]
