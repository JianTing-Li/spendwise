import unittest

from check_pr_issues import closing_issues

REPO = "JianTing-Li/spendwise"


class ClosingIssues(unittest.TestCase):
    def test_keywords_and_colon(self):
        for text in ["Closes #2", "close #2", "Closed: #2", "Fixes #2", "fixed #2", "fix: #2", "Resolves #2", "resolved #2", "RESOLVE #2"]:
            self.assertEqual(closing_issues(text, REPO), ["2"], text)

    def test_same_repository_prefix_only(self):
        self.assertEqual(closing_issues("Closes JianTing-Li/spendwise#4", REPO), ["4"])
        self.assertEqual(closing_issues("Closes other/repo#4", REPO), [])

    def test_ignores_placeholders_partial_refs_comments_and_code(self):
        body = "\n".join([
            "Closes #<issue-number>",
            "Refs #3",
            "<!-- Closes #5 -->",
            "Use `Closes #6` in prose.",
            "```",
            "Closes #7",
            "```",
            "~~~md",
            "Fixes #8",
            "~~~",
        ])
        self.assertEqual(closing_issues(body, REPO), [])

    def test_multiple_and_mixed(self):
        self.assertEqual(closing_issues("Closes #2\nRefs #3\nFixes #9 and `Closes #10`", REPO), ["2", "9"])

    def test_word_boundaries(self):
        self.assertEqual(closing_issues("encloses #2, fixesx #3, Closes #0", REPO), [])


if __name__ == "__main__":
    unittest.main()
