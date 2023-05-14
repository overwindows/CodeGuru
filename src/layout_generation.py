import uuid
from azure_openai import AzureOpenAI 
import os
import platform


def get_directory_structure(markdown_path: str, output_path: str, oai: AzureOpenAI, session_id: uuid, verbose: bool=True):
    markdown_path = os.path.join(markdown_path, 'design_document.md')
    with open(markdown_path, 'r') as f:
        design_doc = f.read()

    prompt_tech_stack = f"""
    A design documentation for a project is enclosed in triple backticks
    ```
    {design_doc}
    ```
    Task:
    summarize the tech stack from the design documentation if it is provided or 
    propose a tech stack to implement such a project from scratch based on the design documentation
    Instruction:
    * do not propose IDE
    * do not propose markdown related tools
    """
    prompt_layout = f"""
    Task:
    Propose a directory structure and file names accordingly 
    Instruction:
    * use only unicode characters
    * provide explanations
    """
    prompt_script = f"""
    Task:
    Generate a {'powershell' if platform.system() == 'Windows' else 'bash'} script to
    * create the directory structure and the files
    * populate the files with the boilerplate code
    * populate README.md with appropriate content
    Instruction:
    * make sure the script can be run successfully without bug
    * do not enclose the script with anything
    * comment out anything that is not executable
    """
    tech_stack = oai.ask_question(prompt_tech_stack, session_id=session_id)
    if verbose:
        print(tech_stack)
    layout_suggestion = oai.ask_question(prompt_layout, session_id=session_id)
    if verbose:
        print(layout_suggestion)
    output_description = os.path.join(output_path, 'description.txt')
    with open(output_description, 'w', encoding='utf-8') as f:
        f.write(tech_stack)
        f.write('\n')
        f.write(layout_suggestion)

    script_commands = oai.ask_question(prompt_script, session_id)

    if platform.system() == 'Windows':
        output_script = os.path.join(output_path, 'create_project.ps1')
    else:
        output_script = os.path.join(output_path, 'create_project.sh')
    with open(output_script, 'w', encoding='utf-8') as f:
        f.write(script_commands)
    if verbose:
        print(script_commands) 