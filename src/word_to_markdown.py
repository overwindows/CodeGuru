import pypandoc
import os
import re
from typing import Dict


def extract(docx_path: str, output_dir_path: str) -> str:
    """convert docx to markdown"""

    output_md_file_path = os.path.join(output_dir_path, 'design_document.md')
    pypandoc.convert_file(
        docx_path, 'md',
        outputfile=output_md_file_path,
        extra_args=[f'--extract-media={output_dir_path}', '--wrap=preserve']
    )

    return output_md_file_path


def embed_image_description(
        output_md_file_path: str,
        image_paths_to_replacement_text_dict:Dict[str, str],
        embedded_output_path: str
) -> None:
    normed_image_path_dict = dict()
    output_builder = list()

    for image_path in image_paths_to_replacement_text_dict:
        normed_image_path = os.path.normpath(image_path)
        normed_image_path_dict[normed_image_path] = image_paths_to_replacement_text_dict[
            image_path]

    with open(output_md_file_path, 'r') as converted_f:
        converted_output = converted_f.read()

    print(normed_image_path_dict)
    image_exp = re.compile(r'!\[.*]\((.*)\)\{.*}')

    text_index = 0

    matches = image_exp.finditer(converted_output)
    for match in matches:
        matched_image_path = match.group(1)
        normed_image_path = os.path.normpath(matched_image_path)
        if normed_image_path in normed_image_path_dict:
            output_builder.append(
                converted_output[text_index:match.start()]
            )

            output_builder.append(
                normed_image_path_dict[normed_image_path]
            )

            text_index = match.end()

    output_builder.append(converted_output[text_index:])

    embedded_text = ''.join(output_builder)
    with open(embedded_output_path, 'w', newline='') as embedded_file:
        print(embedded_text, file=embedded_file)


# Code for testing
if __name__ == '__main__':
    embed_image_description(
        r'C:\code\CodeGuru\docs\markdown\design_document.md',
        {
            r'C:\code\CodeGuru\docs\markdown\media\image1.png': 'This is image1',
            r'C:\code\CodeGuru\docs\markdown\media\image2.png': 'This is image2'
        },
        r'C:\code\CodeGuru\docs\markdown\embedded_design_document.md'
    )
