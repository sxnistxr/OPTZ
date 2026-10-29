from contextlib import redirect_stderr
import io
import resource
import sys
import unittest
from unittest.mock import patch

import request_memory


class DescriptorLimitTests(unittest.TestCase):
    def test_raises_only_soft_limit_and_counts_existing_descriptors(self):
        for hard in (4096, resource.RLIM_INFINITY):
            with self.subTest(hard=hard), \
                    patch.object(request_memory.Path, "iterdir", return_value=iter(range(100))), \
                    patch.object(resource, "getrlimit", return_value=(1024, hard)), \
                    patch.object(resource, "setrlimit") as set_limit:
                request_memory.ensure_fd_limit()
                set_limit.assert_called_once_with(resource.RLIMIT_NOFILE, (1024 + 100 + 32, hard))

    def test_keeps_a_sufficient_or_unlimited_soft_limit(self):
        for soft in (4096, resource.RLIM_INFINITY):
            with self.subTest(soft=soft), \
                    patch.object(request_memory.Path, "iterdir", return_value=iter(range(100))), \
                    patch.object(resource, "getrlimit", return_value=(soft, resource.RLIM_INFINITY)), \
                    patch.object(resource, "setrlimit") as set_limit:
                request_memory.ensure_fd_limit()
                set_limit.assert_not_called()

    def test_small_hard_limit_reports_prerequisite_before_starting_server(self):
        error = io.StringIO()
        with patch.object(sys, "argv", ["request_memory.py"]), \
                patch.object(request_memory.Path, "iterdir", return_value=iter(range(100))), \
                patch.object(resource, "getrlimit", return_value=(1024, 1024)), \
                patch.object(resource, "setrlimit") as set_limit, \
                patch.object(request_memory.harness, "Server") as server, \
                redirect_stderr(error), self.assertRaises(SystemExit) as raised:
            request_memory.main()
        self.assertEqual(raised.exception.code, 2)
        self.assertIn("RLIMIT_NOFILE >= 1156", error.getvalue())
        self.assertIn("increase the hard limit", error.getvalue())
        set_limit.assert_not_called()
        server.assert_not_called()

    def test_failed_soft_limit_change_reports_prerequisite(self):
        for failure in (OSError("limit denied"), ValueError("limit denied")):
            with self.subTest(failure=failure), \
                    patch.object(request_memory.Path, "iterdir", return_value=iter(range(100))), \
                    patch.object(resource, "getrlimit", return_value=(1024, 4096)), \
                    patch.object(resource, "setrlimit", side_effect=failure):
                with self.assertRaisesRegex(RuntimeError, "unable to raise the soft limit"):
                    request_memory.ensure_fd_limit()


if __name__ == "__main__":
    unittest.main()
