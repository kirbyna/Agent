# Gmail Safe MCP development

- Follow the official MCP Python SDK documentation at https://py.sdk.modelcontextprotocol.io/.
- Preserve the `gmail.modify` least-privilege scope and never add permanent-delete Gmail APIs.
- Never retrieve or expose message bodies; return metadata headers only.
- Keep destructive operations bound to a recent preview, an exact confirmation phrase, and at most 20 messages.
- Never commit OAuth client JSON, access tokens, refresh tokens, or email data.
- Run `.venv/bin/python -m unittest discover -s tests -v` after behavior changes.
- For future web pages, follow the KT-inspired visual system: KT Red `#ED2024`, KT Black `#000000`, white/light-gray surfaces, strong grid alignment, square brand marks, restrained borders, and high Korean text readability.
