# Run at install time (install(SCRIPT)): writes the commands in bin/ that start
# the generator scripts installed under <datadir>/qjs-ffi/tools. The prefix is
# only known here, since `cmake --install --prefix` may differ from configure.
foreach(tool genbindings:gen-bindings genstructs:gen-structs)
  string(REPLACE ":" ";" parts "${tool}")
  list(GET parts 0 command)
  list(GET parts 1 script)

  set(wrapper "$ENV{DESTDIR}${CMAKE_INSTALL_PREFIX}/${QJS_FFI_BINDIR}/qjs-ffi-${command}")

  file(WRITE "${wrapper}" "#!/usr/bin/env qjsm\nimport '${CMAKE_INSTALL_PREFIX}/${QJS_FFI_DATADIR}/qjs-ffi/tools/${script}.js';\n")
  execute_process(COMMAND chmod 755 "${wrapper}")
  message(STATUS "Installing: ${wrapper}")
endforeach()
