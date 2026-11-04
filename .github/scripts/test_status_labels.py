import unittest

from status_labels import label_changes, pr_target


class StatusLabels(unittest.TestCase):
    def test_replaces_the_previous_status(self):
        self.assertEqual(
            label_changes(["status:ready", "bug"], "status:review"),
            (["status:review"], ["status:ready"]),
        )

    def test_removes_duplicate_statuses_and_keeps_other_labels(self):
        self.assertEqual(
            label_changes(["status:review", "status:ready", "documentation"], "status:review"),
            ([], ["status:ready"]),
        )

    def test_no_change_when_already_set(self):
        self.assertEqual(label_changes(["status:done"], "status:done"), ([], []))

    def test_draft_prs_mean_in_progress(self):
        self.assertEqual(pr_target(True), "status:in-progress")
        self.assertEqual(pr_target(False), "status:review")


if __name__ == "__main__":
    unittest.main()
