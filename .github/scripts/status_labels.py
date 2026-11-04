"""Keep exactly one status:* label on issues as PRs and issues move.

PR text and issue data arrive as environment data and are passed to `gh` as
argument lists; nothing from GitHub is interpolated into a shell.
"""
import json
import os
import subprocess
import sys

from check_pr_issues import closing_issues

STATUSES = ["status:ready", "status:in-progress", "status:review", "status:done"]


def label_changes(current: list[str], target: str) -> tuple[list[str], list[str]]:
    """Labels to add and remove so `target` is the only status label."""
    add = [] if target in current else [target]
    remove = [label for label in current if label in STATUSES and label != target]
    return add, remove


def pr_target(draft: bool) -> str:
    return "status:in-progress" if draft else "status:review"


def gh(*args: str) -> str:
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def apply(issue: str, target: str, skip_closed: bool) -> None:
    data = json.loads(gh("issue", "view", issue, "--json", "labels,state"))
    if skip_closed and data["state"] == "CLOSED":
        print(f"#{issue}: closed, left unchanged")
        return
    add, remove = label_changes([label["name"] for label in data["labels"]], target)
    if not add and not remove:
        print(f"#{issue}: already {target}")
        return
    args = ["issue", "edit", issue]
    for label in add:
        args += ["--add-label", label]
    for label in remove:
        args += ["--remove-label", label]
    gh(*args)
    print(f"#{issue}: now {target}")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "pr":
        target = pr_target(os.environ.get("PR_DRAFT") == "true")
        issues = closing_issues(os.environ.get("PR_BODY", ""), os.environ.get("GITHUB_REPOSITORY", ""))
        for number in dict.fromkeys(issues):
            apply(number, target, skip_closed=True)
    elif mode == "issue":
        apply(os.environ["ISSUE_NUMBER"], "status:done", skip_closed=False)
    else:
        sys.exit("usage: status_labels.py pr|issue")
