package proc

import (
	"os/exec"
	"unsafe"

	"golang.org/x/sys/windows"
)

// group is a job the command is put in, and every process it starts with
// it; closing the job ends them all, as it does when magpie exits. A
// command that can't be put in one is killed alone.
type group struct{ job windows.Handle }

func ownGroup(*exec.Cmd) {}

func (g *group) join(cmd *exec.Cmd) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{
		LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE}}
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		_ = windows.CloseHandle(job)
		return
	}
	h, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err != nil {
		_ = windows.CloseHandle(job)
		return
	}
	defer windows.CloseHandle(h)
	if err := windows.AssignProcessToJobObject(job, h); err != nil {
		_ = windows.CloseHandle(job)
		return
	}
	g.job = job
}

func (g *group) kill(*exec.Cmd) {
	if g.job != 0 {
		_ = windows.TerminateJobObject(g.job, 1)
	}
}

func (g *group) sweep(*exec.Cmd) {
	if g.job != 0 {
		_ = windows.CloseHandle(g.job)
		g.job = 0
	}
}
