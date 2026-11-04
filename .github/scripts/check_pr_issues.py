"""Require a real closing reference in PR prose; never execute PR-body content."""
import os
import re
import sys

KEYWORDS = r"(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)"


def prose_lines(body: str) -> str:
    """Drop HTML comments, fenced blocks and inline code spans."""
    body = re.sub(r"<!--.*?-->", "", body, flags=re.S)
    prose = []
    fence = None
    for line in body.splitlines():
        stripped = line.lstrip()
        if stripped.startswith(("```", "~~~")):
            marker = stripped[:3]
            fence = None if fence == marker else (fence or marker)
            continue
        if fence is None:
            prose.append(re.sub(r"(`+).*?\1", "", line))
    return "\n".join(prose)


def closing_issues(body: str, repository: str = "") -> list[str]:
    """Issue numbers closed in this repository (#N, or owner/repo#N for this repository)."""
    pattern = rf"\b{KEYWORDS}:?\s+([\w.-]+/[\w.-]+)?#([1-9]\d*)\b"
    found = []
    for repo, number in re.findall(pattern, prose_lines(body), re.I):
        if not repo or repo.lower() == repository.lower():
            found.append(number)
    return found


if __name__ == "__main__":
    issues = closing_issues(
        os.environ.get("PR_BODY", ""), os.environ.get("GITHUB_REPOSITORY", "")
    )
    if not issues:
        print("PR description must contain Closes #<issue-number> for at least one fully completed issue. Use Refs #... for partial work; do not close unfinished work.")
        sys.exit(1)
    print("Closing references found: " + ", ".join("#" + issue for issue in issues))
